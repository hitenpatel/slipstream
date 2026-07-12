"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  TriageEventSchema,
  type Issue,
  type IssuePriority,
  type Label,
  type TriageSuggestion,
} from "@slipstream/protocol";
import { PRIORITY_LABEL } from "./filters";
import styles from "./triage-panel.module.css";

type Phase = "idle" | "streaming" | "done" | "error";

/**
 * AI triage section of the issue dialog. Streams the model's rationale from
 * POST /api/ai/triage, then renders the parsed suggestion as accept buttons.
 * Accepting a part goes through the normal `updateIssue` mutator (via
 * onMutate) so optimistic updates, the offline outbox and multi-client sync
 * behave exactly as a manual edit — the server never mutates on our behalf.
 */
export function TriagePanel({
  issue,
  labels,
  issues,
  onMutate,
}: {
  issue: Issue;
  labels: Label[];
  issues: Issue[];
  onMutate: (name: string, args: unknown) => Promise<void>;
}): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [phase, setPhase] = useState<Phase>("idle");
  const [rationale, setRationale] = useState("");
  const [suggestion, setSuggestion] = useState<TriageSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset when the dialog moves to a different issue; abort any in-flight stream.
  useEffect(() => {
    abortRef.current?.abort();
    setPhase("idle");
    setRationale("");
    setSuggestion(null);
    setError(null);
  }, [issue.id]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run(): Promise<void> {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("streaming");
    setRationale("");
    setSuggestion(null);
    setError(null);

    let streamError: string | null = null;
    try {
      const res = await fetch("/api/ai/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: issue.id }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        setError(httpErrorMessage(res.status));
        setPhase("error");
        return;
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
          let raw: unknown;
          try {
            raw = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          const parsed = TriageEventSchema.safeParse(raw);
          if (!parsed.success) continue;
          const ev = parsed.data;
          if (ev.type === "delta") setRationale((r) => r + ev.text);
          else if (ev.type === "suggestion") setSuggestion(ev.suggestion);
          else if (ev.type === "error") streamError = ev.error;
        }
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      streamError = (err as Error).message;
    }
    if (ac.signal.aborted) return;
    if (streamError) {
      setError(streamError);
      setPhase("error");
    } else {
      setPhase("done");
    }
  }

  async function addLabel(labelId: string): Promise<void> {
    if (issue.labelIds.includes(labelId)) return;
    await onMutate("updateIssue", {
      id: issue.id,
      patch: { labelIds: [...issue.labelIds, labelId] },
    });
  }

  async function applyPriority(p: IssuePriority): Promise<void> {
    await onMutate("updateIssue", { id: issue.id, patch: { priority: p } });
  }

  function openIssue(id: string): void {
    const next = new URLSearchParams(params.toString());
    next.set("issue", id);
    router.replace(`?${next.toString()}`);
  }

  // The stub/model output ends with a fenced JSON block — show only the prose.
  const rationaleText = rationale.split("```")[0]!.trimStart();
  const emptySuggestion =
    suggestion !== null &&
    suggestion.labelIds.length === 0 &&
    suggestion.priority === null &&
    suggestion.duplicateIssueIds.length === 0;

  return (
    <section className={styles.panel} aria-labelledby="triage-h">
      <div className={styles.headRow}>
        <h3 id="triage-h" className={styles.sectionTitle}>
          AI triage
        </h3>
        <button
          type="button"
          className={styles.suggestBtn}
          onClick={() => void run()}
          disabled={phase === "streaming"}
        >
          {phase === "streaming" ? "Thinking…" : phase === "idle" ? "Suggest" : "Suggest again"}
        </button>
      </div>

      {/* Streaming text into a live region is noisy for screen readers, so
         the live region only announces phase changes; the rationale itself
         is a normal read-on-demand block. */}
      <p className={styles.srOnly} aria-live="polite">
        {phase === "streaming"
          ? "Analysing issue…"
          : phase === "done"
            ? "Triage suggestion ready."
            : phase === "error"
              ? "Triage failed."
              : ""}
      </p>

      {rationaleText ? <p className={styles.rationale}>{rationaleText}</p> : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      {suggestion ? (
        emptySuggestion ? (
          <p className={styles.muted}>No changes suggested — this issue already looks well triaged.</p>
        ) : (
          <div className={styles.suggestion}>
            <ul className={styles.actions}>
              {suggestion.labelIds.map((id) => {
                const label = labels.find((l) => l.id === id);
                if (!label) return null;
                const applied = issue.labelIds.includes(id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={styles.acceptBtn}
                      disabled={applied}
                      onClick={() => void addLabel(id)}
                    >
                      {applied ? `Label “${label.name}” added` : `Add label “${label.name}”`}
                    </button>
                  </li>
                );
              })}
              {suggestion.priority !== null ? (
                <li>
                  <button
                    type="button"
                    className={styles.acceptBtn}
                    disabled={issue.priority === suggestion.priority}
                    onClick={() => void applyPriority(suggestion.priority!)}
                  >
                    {issue.priority === suggestion.priority
                      ? `Priority set to ${PRIORITY_LABEL[suggestion.priority]}`
                      : `Set priority to ${PRIORITY_LABEL[suggestion.priority]}`}
                  </button>
                </li>
              ) : null}
            </ul>
            {suggestion.duplicateIssueIds.length > 0 ? (
              <div className={styles.duplicates}>
                <p className={styles.dupHeading}>Possible duplicates</p>
                <ul className={styles.dupList}>
                  {suggestion.duplicateIssueIds.map((id) => {
                    const dup = issues.find((i) => i.id === id);
                    if (!dup) return null;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className={styles.dupLink}
                          onClick={() => openIssue(id)}
                        >
                          {dup.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </section>
  );
}

function httpErrorMessage(status: number): string {
  if (status === 429) return "Rate limit reached for this workspace — try again in a while.";
  if (status === 503) return "AI triage isn't available on this server.";
  return "Triage request failed.";
}
