import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { between, uuidv7, type Mutation } from "@slipstream/protocol";
import { startMemoryDb } from "./test-helpers.js";
import { applyPush } from "./push.js";
import { pull } from "./pull.js";
import type { SlipstreamDb } from "./db.js";

let db: SlipstreamDb;
let stop: () => Promise<void>;

beforeAll(async () => {
  ({ db, stop } = await startMemoryDb());
}, 60_000);
// poke broker isn't used by these tests; the websocket suite covers it

afterAll(async () => {
  await stop();
});

function mut(clientID: string, id: number, name: string, args: unknown): Mutation {
  return { id, clientID, name, args };
}

describe("push handler", () => {
  it("runs mutators inside a transaction, stamps versions monotonically, and advances lastMutationID", async () => {
    const clientID = uuidv7();
    const wsId = uuidv7();
    const projectId = uuidv7();
    const issueId = uuidv7();

    const res = await applyPush(db, {
      clientID,
      mutations: [
        mut(clientID, 1, "createWorkspace", { id: wsId, name: "Acme" }),
        mut(clientID, 2, "createProject", { id: projectId, workspaceId: wsId, name: "Slipstream", key: "SL" }),
        mut(clientID, 3, "createIssue", {
          id: issueId,
          workspaceId: wsId,
          projectId,
          title: "Hello",
          position: between(null, null),
        }),
      ],
    });

    expect(res.lastMutationID).toBe(3);
    expect(res.cookie).toBeGreaterThanOrEqual(3);

    const ws = await db.entities.findOne({ _id: wsId });
    const proj = await db.entities.findOne({ _id: projectId });
    const issue = await db.entities.findOne({ _id: issueId });
    expect(ws?.kind).toBe("workspace");
    expect(proj?.kind).toBe("project");
    expect(issue?.kind).toBe("issue");
    // versions are strictly increasing across the batch
    expect((ws?.version ?? 0) < (proj?.version ?? 0)).toBe(true);
    expect((proj?.version ?? 0) < (issue?.version ?? 0)).toBe(true);
  });

  it("is idempotent: replaying a confirmed mutation is a no-op", async () => {
    const clientID = uuidv7();
    const wsId = uuidv7();

    const first = await applyPush(db, {
      clientID,
      mutations: [mut(clientID, 1, "createWorkspace", { id: wsId, name: "First" })],
    });
    const wsAfterFirst = await db.entities.findOne({ _id: wsId });

    const replay = await applyPush(db, {
      clientID,
      mutations: [mut(clientID, 1, "createWorkspace", { id: wsId, name: "ignored on replay" })],
    });
    const wsAfterReplay = await db.entities.findOne({ _id: wsId });

    expect(first.lastMutationID).toBe(1);
    expect(replay.lastMutationID).toBe(1);
    expect(wsAfterReplay).toEqual(wsAfterFirst);
  });

  it("stops at a gap in client ids and the next call resumes", async () => {
    const clientID = uuidv7();
    const a = uuidv7();
    const b = uuidv7();

    // Send id=1 and id=3 (id=2 missing). Server should apply only id=1.
    const first = await applyPush(db, {
      clientID,
      mutations: [
        mut(clientID, 1, "createWorkspace", { id: a, name: "A" }),
        mut(clientID, 3, "createWorkspace", { id: b, name: "B" }),
      ],
    });
    expect(first.lastMutationID).toBe(1);
    expect(await db.entities.findOne({ _id: a })).not.toBeNull();
    expect(await db.entities.findOne({ _id: b })).toBeNull();

    // Now provide id=2 alongside the resend of id=3; both should apply.
    const next = await applyPush(db, {
      clientID,
      mutations: [
        mut(clientID, 2, "createWorkspace", { id: uuidv7(), name: "Filler" }),
        mut(clientID, 3, "createWorkspace", { id: b, name: "B" }),
      ],
    });
    expect(next.lastMutationID).toBe(3);
    expect(await db.entities.findOne({ _id: b })).not.toBeNull();
  });

  it("rejects a mutation with a mismatched clientID", async () => {
    const clientID = uuidv7();
    const evilClientID = uuidv7();
    await expect(
      applyPush(db, {
        clientID,
        mutations: [mut(evilClientID, 1, "createWorkspace", { id: uuidv7(), name: "X" })],
      }),
    ).rejects.toThrow(/clientID mismatch/);
  });

  it("rolls back the whole batch if a mutation throws (Mongo transaction guarantees)", async () => {
    const clientID = uuidv7();
    const okWs = uuidv7();
    // unknown mutator name causes runMutator to throw; the prior put must roll back
    await expect(
      applyPush(db, {
        clientID,
        mutations: [
          mut(clientID, 1, "createWorkspace", { id: okWs, name: "Ok" }),
          mut(clientID, 2, "doesNotExist", {}),
        ],
      }),
    ).rejects.toThrow();
    const wsAfter = await db.entities.findOne({ _id: okWs });
    expect(wsAfter).toBeNull();
    const client = await db.clients.findOne({ _id: clientID });
    expect(client?.lastMutationID ?? 0).toBe(0);
  });
});

describe("pull handler", () => {
  it("returns the patch since the cookie and reports the client's lastMutationID", async () => {
    const clientID = uuidv7();
    const wsId = uuidv7();

    // Snapshot the head before this test's writes so we can pull a clean delta.
    const before = await db.counters.findOne({ _id: "global" });
    const beforeCookie = before?.seq ?? 0;

    await applyPush(db, {
      clientID,
      mutations: [mut(clientID, 1, "createWorkspace", { id: wsId, name: "Acme" })],
    });

    const out = await pull(db, { clientID, cookie: beforeCookie });
    expect(out.lastMutationID).toBe(1);
    expect(out.cookie).toBeGreaterThan(beforeCookie);
    const sawWorkspace = out.patch.some(
      (op) => op.op === "put" && (op as { op: "put"; entity: { id: string } }).entity.id === wsId,
    );
    expect(sawWorkspace).toBe(true);
  });

  it("returns an empty patch when the cookie is already current", async () => {
    const clientID = uuidv7();
    const head = await db.counters.findOne({ _id: "global" });
    const cookie = head?.seq ?? 0;
    const out = await pull(db, { clientID, cookie });
    expect(out.patch).toEqual([]);
    expect(out.cookie).toBe(cookie);
  });

  it("emits a del op for soft-deleted entities", async () => {
    const clientID = uuidv7();
    const wsId = uuidv7();
    const projectId = uuidv7();
    const issueId = uuidv7();
    await applyPush(db, {
      clientID,
      mutations: [
        mut(clientID, 1, "createWorkspace", { id: wsId, name: "Acme" }),
        mut(clientID, 2, "createProject", { id: projectId, workspaceId: wsId, name: "Slipstream", key: "SL" }),
        mut(clientID, 3, "createIssue", {
          id: issueId,
          workspaceId: wsId,
          projectId,
          title: "Doomed",
          position: between(null, null),
        }),
      ],
    });
    const headBeforeDelete = (await db.counters.findOne({ _id: "global" }))?.seq ?? 0;
    await applyPush(db, {
      clientID,
      mutations: [mut(clientID, 4, "deleteIssue", { id: issueId })],
    });

    const out = await pull(db, { clientID, cookie: headBeforeDelete });
    const sawDel = out.patch.some((op) => op.op === "del" && op.id === issueId);
    expect(sawDel).toBe(true);
  });
});

describe("total ordering under concurrent pushes", () => {
  it("two concurrent batches both succeed and produce strictly monotonic versions", async () => {
    const clientA = uuidv7();
    const clientB = uuidv7();

    const head = (await db.counters.findOne({ _id: "global" }))?.seq ?? 0;

    const [resA, resB] = await Promise.all([
      applyPush(db, {
        clientID: clientA,
        mutations: [
          mut(clientA, 1, "createWorkspace", { id: uuidv7(), name: "A1" }),
          mut(clientA, 2, "createWorkspace", { id: uuidv7(), name: "A2" }),
        ],
      }),
      applyPush(db, {
        clientID: clientB,
        mutations: [
          mut(clientB, 1, "createWorkspace", { id: uuidv7(), name: "B1" }),
          mut(clientB, 2, "createWorkspace", { id: uuidv7(), name: "B2" }),
        ],
      }),
    ]);

    expect(resA.lastMutationID).toBe(2);
    expect(resB.lastMutationID).toBe(2);

    const after = (await db.counters.findOne({ _id: "global" }))?.seq ?? 0;
    expect(after - head).toBe(4); // one tick per mutator

    const newDocs = await db.entities.find({ version: { $gt: head } }).sort({ version: 1 }).toArray();
    const versions = newDocs.map((d) => d.version);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]! > versions[i - 1]!).toBe(true);
    }
  });
});
