/**
 * AI triage: given an issue, suggest labels, a priority, and likely
 * duplicates from the same project. The LLM streams a short rationale
 * followed by a fenced JSON block; we relay the rationale as SSE deltas and
 * parse the JSON into a validated TriageSuggestion.
 *
 * The model never sees or emits raw entity ids — labels are referenced by
 * name and sibling issues by list index, and we map back to ids here.
 * Free-tier providers only (Groq); TRIAGE_PROVIDER=stub yields a
 * deterministic canned response for tests and the e2e harness.
 */

import {
  TriageSuggestionSchema,
  type IssuePriority,
  type TriageSuggestion,
} from "@slipstream/protocol";

export interface TriageIssueInput {
  title: string;
  description: string; // plaintext, already decoded from the Y.Doc
  status: string;
  priority: number;
  labelNames: string[]; // labels currently on the issue
}

export interface TriageLabel {
  id: string;
  name: string;
}

export interface TriageSibling {
  id: string;
  title: string;
  status: string;
}

export interface TriageContext {
  issue: TriageIssueInput;
  labels: TriageLabel[];
  siblings: TriageSibling[];
}

const MAX_DESCRIPTION_CHARS = 4000;
const MAX_SIBLINGS = 60;

export function buildTriagePrompt(ctx: TriageContext): Array<{ role: "system" | "user"; content: string }> {
  const labels = ctx.labels.map((l) => `- ${l.name}`).join("\n") || "- (none defined)";
  const siblings =
    ctx.siblings
      .slice(0, MAX_SIBLINGS)
      .map((s, i) => `${i}. [${s.status}] ${s.title}`)
      .join("\n") || "(no other issues)";
  const description = ctx.issue.description.slice(0, MAX_DESCRIPTION_CHARS) || "(no description)";

  return [
    {
      role: "system",
      content:
        "You are a triage assistant for an issue tracker. Analyse the issue and suggest: " +
        "(1) which of the existing labels apply, (2) a priority from 0-4 " +
        "(0=none, 1=low, 2=medium, 3=high, 4=urgent), (3) which other issues look like duplicates. " +
        "Only suggest labels from the provided list, by exact name. Refer to potential duplicates " +
        "by their list index number. Be conservative: no duplicates is the common case.\n\n" +
        "Reply with a rationale of at most 3 short sentences, then exactly one fenced JSON block:\n" +
        '```json\n{"labels": ["name"], "priority": 2, "duplicates": [0]}\n```\n' +
        'Use "priority": null if the current priority already seems right, an empty "labels" array ' +
        'if none apply, and an empty "duplicates" array if nothing matches.',
    },
    {
      role: "user",
      content:
        `Issue title: ${ctx.issue.title}\n` +
        `Current status: ${ctx.issue.status}\n` +
        `Current priority: ${ctx.issue.priority}\n` +
        `Current labels: ${ctx.issue.labelNames.join(", ") || "(none)"}\n\n` +
        `Description:\n${description}\n\n` +
        `Available labels:\n${labels}\n\n` +
        `Other issues in this project:\n${siblings}`,
    },
  ];
}

/**
 * Parse the model's full output. Returns the validated suggestion with
 * label names / sibling indexes mapped back to entity ids. Unknown label
 * names and out-of-range indexes are dropped rather than failing the whole
 * suggestion.
 */
export function parseTriageOutput(text: string, ctx: TriageContext): TriageSuggestion {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!match?.[1]) throw new Error("no JSON block in model output");

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    throw new Error("model JSON block is not valid JSON");
  }
  const obj = (raw ?? {}) as { labels?: unknown; priority?: unknown; duplicates?: unknown };

  const byName = new Map(ctx.labels.map((l) => [l.name.toLowerCase(), l.id]));
  const currentLabels = new Set(ctx.issue.labelNames.map((n) => n.toLowerCase()));
  const labelIds = (Array.isArray(obj.labels) ? obj.labels : [])
    .filter((n): n is string => typeof n === "string")
    .filter((n) => !currentLabels.has(n.toLowerCase()))
    .map((n) => byName.get(n.toLowerCase()))
    .filter((id): id is string => id !== undefined);

  let priority: IssuePriority | null = null;
  if (typeof obj.priority === "number" && [0, 1, 2, 3, 4].includes(obj.priority)) {
    priority = obj.priority as IssuePriority;
    if (priority === ctx.issue.priority) priority = null; // no-op suggestion
  }

  const siblings = ctx.siblings.slice(0, MAX_SIBLINGS);
  const duplicateIssueIds = (Array.isArray(obj.duplicates) ? obj.duplicates : [])
    .filter((i): i is number => typeof i === "number" && Number.isInteger(i))
    .filter((i) => i >= 0 && i < siblings.length)
    .map((i) => siblings[i]!.id);

  return TriageSuggestionSchema.parse({
    labelIds: [...new Set(labelIds)],
    priority,
    duplicateIssueIds: [...new Set(duplicateIssueIds)],
  });
}

// -- providers -------------------------------------------------------------

export type TriageProvider = (
  messages: Array<{ role: "system" | "user"; content: string }>,
  signal: AbortSignal,
) => AsyncGenerator<string, void, void>;

/** Streams completion deltas from Groq's OpenAI-compatible chat endpoint. */
export function groqProvider(apiKey: string, model: string): TriageProvider {
  return async function* (messages, signal) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.2, max_tokens: 600 }),
      signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`groq ${res.status}: ${detail.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return;
        try {
          const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // partial/keepalive line — ignore
        }
      }
    }
  };
}

/**
 * Deterministic provider for tests and the e2e harness: suggests the first
 * available label the issue doesn't already have, priority 3, and the first
 * sibling as a duplicate when the titles share a word of 5+ chars.
 */
export function stubProvider(ctx: TriageContext): TriageProvider {
  return async function* () {
    const firstNew = ctx.labels.find(
      (l) => !ctx.issue.labelNames.some((n) => n.toLowerCase() === l.name.toLowerCase()),
    );
    const titleWords = new Set(
      ctx.issue.title.toLowerCase().split(/\W+/).filter((w) => w.length >= 5),
    );
    const dupIndex = ctx.siblings.findIndex((s) =>
      s.title.toLowerCase().split(/\W+/).some((w) => titleWords.has(w)),
    );
    const body = JSON.stringify({
      labels: firstNew ? [firstNew.name] : [],
      priority: ctx.issue.priority === 3 ? 2 : 3,
      duplicates: dupIndex >= 0 ? [dupIndex] : [],
    });
    for (const chunk of ["Stubbed rationale: ", "deterministic suggestion for tests.", "\n```json\n", body, "\n```"]) {
      yield chunk;
    }
  };
}

// -- rate limiting ----------------------------------------------------------

const LIMIT_PER_HOUR = 15;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

export function _resetTriageLimiter(): void {
  hits.clear();
}

/**
 * Per-workspace sliding-window limit. The shared demo workspace gets the
 * same ceiling as everyone else — enough to showcase the feature, small
 * enough that it can't drain the free-tier daily token budget.
 */
export function triageRateLimited(workspaceId: string, now = Date.now()): boolean {
  const recent = (hits.get(workspaceId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT_PER_HOUR) {
    hits.set(workspaceId, recent);
    return true;
  }
  recent.push(now);
  hits.set(workspaceId, recent);
  return false;
}
