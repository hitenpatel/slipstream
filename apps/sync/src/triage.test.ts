import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7, type Issue, type Label, type TriageEvent } from "@slipstream/protocol";
import { createApp } from "./server.js";
import { InProcessPresenceBroker } from "./presence.js";
import { startMemoryDb } from "./test-helpers.js";
import type { SlipstreamDb } from "./db.js";
import {
  _resetTriageLimiter,
  buildTriagePrompt,
  parseTriageOutput,
  stubProvider,
  triageRateLimited,
  type TriageContext,
} from "./triage.js";

// -- unit: prompt + parse ----------------------------------------------------

const ctx: TriageContext = {
  issue: {
    title: "Fix reconnect loop after laptop sleep",
    description: "WebSocket reconnects in a tight loop when the machine wakes.",
    status: "todo",
    priority: 2,
    labelNames: ["bug"],
  },
  labels: [
    { id: "lbl-bug", name: "bug" },
    { id: "lbl-perf", name: "perf" },
    { id: "lbl-debt", name: "tech-debt" },
  ],
  siblings: [
    { id: "iss-1", title: "Resolve clock skew on reconnect", status: "backlog" },
    { id: "iss-2", title: "Dark mode toggle", status: "todo" },
  ],
};

describe("buildTriagePrompt", () => {
  it("includes available labels, current labels, and indexed siblings", () => {
    const [system, user] = buildTriagePrompt(ctx);
    expect(system!.role).toBe("system");
    expect(user!.content).toContain("- perf");
    expect(user!.content).toContain("Current labels: bug");
    expect(user!.content).toContain("0. [backlog] Resolve clock skew on reconnect");
    expect(user!.content).toContain("1. [todo] Dark mode toggle");
  });

  it("caps very long descriptions", () => {
    const long = { ...ctx, issue: { ...ctx.issue, description: "x".repeat(10_000) } };
    const [, user] = buildTriagePrompt(long);
    expect(user!.content.length).toBeLessThan(9_000);
  });
});

describe("parseTriageOutput", () => {
  const wrap = (json: string) => `Some rationale here.\n\`\`\`json\n${json}\n\`\`\``;

  it("maps label names and sibling indexes to entity ids", () => {
    const s = parseTriageOutput(wrap('{"labels":["perf"],"priority":4,"duplicates":[0]}'), ctx);
    expect(s).toEqual({ labelIds: ["lbl-perf"], priority: 4, duplicateIssueIds: ["iss-1"] });
  });

  it("drops unknown labels, labels already on the issue, and bad indexes", () => {
    const s = parseTriageOutput(
      wrap('{"labels":["bug","nonsense","PERF","perf"],"priority":9,"duplicates":[5,-1,1]}'),
      ctx,
    );
    expect(s.labelIds).toEqual(["lbl-perf"]); // case-insensitive, deduped, "bug" already applied
    expect(s.priority).toBeNull(); // 9 is invalid
    expect(s.duplicateIssueIds).toEqual(["iss-2"]);
  });

  it("nulls the priority when it matches the current one", () => {
    const s = parseTriageOutput(wrap('{"labels":[],"priority":2,"duplicates":[]}'), ctx);
    expect(s.priority).toBeNull();
  });

  it("throws on missing or malformed JSON block", () => {
    expect(() => parseTriageOutput("no json here", ctx)).toThrow(/no JSON block/);
    expect(() => parseTriageOutput(wrap("{nope"), ctx)).toThrow(/not valid JSON/);
  });
});

describe("stubProvider", () => {
  it("streams text whose JSON block parses into a valid suggestion", async () => {
    let full = "";
    for await (const d of stubProvider(ctx)(buildTriagePrompt(ctx), new AbortController().signal)) {
      full += d;
    }
    const s = parseTriageOutput(full, ctx);
    expect(s.labelIds).toEqual(["lbl-perf"]); // first label not already applied
    expect(s.priority).toBe(3);
    expect(s.duplicateIssueIds).toEqual(["iss-1"]); // shares "reconnect"
  });
});

describe("triageRateLimited", () => {
  beforeEach(() => _resetTriageLimiter());

  it("allows 15 per hour per workspace then blocks, isolating workspaces", () => {
    for (let i = 0; i < 15; i++) expect(triageRateLimited("ws-a")).toBe(false);
    expect(triageRateLimited("ws-a")).toBe(true);
    expect(triageRateLimited("ws-b")).toBe(false);
  });

  it("frees slots once the window slides past", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 15; i++) triageRateLimited("ws-c", t0);
    expect(triageRateLimited("ws-c", t0)).toBe(true);
    expect(triageRateLimited("ws-c", t0 + 61 * 60 * 1000)).toBe(false);
  });
});

// -- integration: the /api/ai/triage route -----------------------------------

let db: SlipstreamDb;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, stop } = await startMemoryDb());
}, 60_000);

afterAll(async () => {
  await stop();
});

describe("POST /api/ai/triage", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  const savedProvider = process.env.TRIAGE_PROVIDER;

  beforeEach(async () => {
    process.env.TRIAGE_PROVIDER = "stub";
    _resetTriageLimiter();
    const app = createApp({ db, broker: new InProcessPresenceBroker() });
    const httpServer = serve({ fetch: app.fetch, port: 0 });
    await new Promise<void>((resolve) => {
      if ((httpServer as { listening?: boolean }).listening) resolve();
      else (httpServer as { once: (e: string, cb: () => void) => void }).once("listening", () => resolve());
    });
    const addr = (httpServer as { address: () => AddressInfo }).address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        (httpServer as { close: (cb: (err?: Error) => void) => void }).close((err) =>
          err ? reject(err) : resolve(),
        );
      });
    await db.accounts.deleteMany({});
    await db.sessions.deleteMany({});
    await db.entities.deleteMany({});
  });

  afterEach(async () => {
    if (savedProvider === undefined) delete process.env.TRIAGE_PROVIDER;
    else process.env.TRIAGE_PROVIDER = savedProvider;
    await closeServer();
  });

  async function seedSession(workspaceId: string): Promise<string> {
    const token = uuidv7();
    await db.sessions.insertOne({
      _id: token,
      userId: uuidv7(),
      workspaceId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3_600_000,
    });
    return token;
  }

  function entityBase(workspaceId: string) {
    return {
      workspaceId,
      version: 1,
      deleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  async function seedIssue(workspaceId: string, projectId: string, over: Partial<Issue> = {}): Promise<string> {
    const id = uuidv7();
    const doc: Issue & { _id: string } = {
      _id: id,
      id,
      kind: "issue",
      projectId,
      title: "Fix reconnect loop after laptop sleep",
      description: "Reconnects in a tight loop after wake.",
      status: "todo",
      priority: 2,
      assigneeId: null,
      labelIds: [],
      position: "a0",
      ...entityBase(workspaceId),
      ...over,
    };
    await db.entities.insertOne(doc);
    return id;
  }

  async function seedLabel(workspaceId: string, projectId: string, name: string): Promise<string> {
    const id = uuidv7();
    const doc: Label & { _id: string } = {
      _id: id,
      id,
      kind: "label",
      projectId,
      name,
      colour: "#a7b4ff",
      ...entityBase(workspaceId),
    };
    await db.entities.insertOne(doc);
    return id;
  }

  async function callTriage(issueId: string, token?: string): Promise<Response> {
    return fetch(`${baseUrl}/api/ai/triage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { cookie: `slipstream_session=${token}` } : {}),
      },
      body: JSON.stringify({ issueId }),
    });
  }

  async function readEvents(res: Response): Promise<TriageEvent[]> {
    const text = await res.text();
    return text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)) as TriageEvent);
  }

  it("rejects unauthenticated requests", async () => {
    const res = await callTriage(uuidv7());
    expect(res.status).toBe(401);
  });

  it("404s for issues outside the session workspace", async () => {
    const wsA = uuidv7();
    const wsB = uuidv7();
    const issueId = await seedIssue(wsA, uuidv7());
    const token = await seedSession(wsB);
    const res = await callTriage(issueId, token);
    expect(res.status).toBe(404);
  });

  it("streams deltas then a validated suggestion then done", async () => {
    const ws = uuidv7();
    const project = uuidv7();
    const labelId = await seedLabel(ws, project, "perf");
    const issueId = await seedIssue(ws, project);
    await seedIssue(ws, project, { title: "Resolve clock skew on reconnect" });
    const token = await seedSession(ws);

    const res = await callTriage(issueId, token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await readEvents(res);
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "delta").length).toBeGreaterThan(0);
    expect(types).toContain("suggestion");
    expect(types.at(-1)).toBe("done");

    const suggestion = events.find((e) => e.type === "suggestion");
    if (suggestion?.type !== "suggestion") throw new Error("unreachable");
    expect(suggestion.suggestion.labelIds).toEqual([labelId]);
    expect(suggestion.suggestion.priority).toBe(3);
    expect(suggestion.suggestion.duplicateIssueIds).toHaveLength(1);
  });

  it("returns 503 when no provider is configured", async () => {
    process.env.TRIAGE_PROVIDER = "disabled";
    const ws = uuidv7();
    const issueId = await seedIssue(ws, uuidv7());
    const token = await seedSession(ws);
    const res = await callTriage(issueId, token);
    expect(res.status).toBe(503);
  });

  it("rate-limits a workspace after 15 calls", async () => {
    const ws = uuidv7();
    const project = uuidv7();
    const issueId = await seedIssue(ws, project);
    const token = await seedSession(ws);
    for (let i = 0; i < 15; i++) {
      const res = await callTriage(issueId, token);
      expect(res.status).toBe(200);
      await res.text(); // drain
    }
    const blocked = await callTriage(issueId, token);
    expect(blocked.status).toBe(429);
  });
});
