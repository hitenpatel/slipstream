import { describe, expect, it } from "vitest";
import {
  between,
  MemoryTx,
  MemoryView,
  runMutator,
  uuidv7,
  type Entity,
  type EntityKind,
  type PatchOp,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from "@slipstream/protocol";
import { Engine } from "./engine.js";
import { MemoryClientStorage } from "./storage.js";
import type { Transport } from "./transport.js";

/**
 * In-process server stand-in. The push/pull semantics mirror the real sync
 * server's behaviour at the protocol level: idempotent in-order push, version
 * stamping via a global counter, pull = patch since cookie.
 *
 * The point of having one of these is that we can drive interleaved
 * online/offline scenarios deterministically, without standing up Mongo.
 * The MongoDB-backed integration tests live in apps/sync and prove the real
 * server obeys the same contract — see apps/sync/src/push.test.ts.
 */
class FakeServer {
  private seq = 0;
  private base = new MemoryView();
  private clients = new Map<string, number>();
  /** records the version at which each entity last changed, for patch-by-cookie */
  private touched = new Map<string, number>();

  private static key(kind: EntityKind | string, id: string): string {
    return `${kind}:${id}`;
  }

  push = async (req: PushRequest): Promise<PushResponse> => {
    let last = this.clients.get(req.clientID) ?? 0;
    const sorted = [...req.mutations].sort((a, b) => a.id - b.id);
    for (const m of sorted) {
      if (m.clientID !== req.clientID) throw new Error("clientID mismatch");
      if (m.id <= last) continue;
      if (m.id !== last + 1) break;

      this.seq++;
      const version = this.seq;
      const before = new Set(this.base.entities.keys());
      const tx = new MemoryTx(this.base, { version, now: 0 });
      runMutator(tx, m.name, m.args);
      // Mark touched: any entity created or modified this tick.
      for (const [k, e] of this.base.entities) {
        if (e.version === version || !before.has(k)) {
          this.touched.set(k, version);
        }
      }
      last = m.id;
    }
    this.clients.set(req.clientID, last);
    return { lastMutationID: last, cookie: this.seq };
  };

  pull = async (req: PullRequest): Promise<PullResponse> => {
    const patch: PatchOp[] = [];
    for (const [k, v] of this.touched) {
      if (v <= req.cookie) continue;
      const entity = this.base.entities.get(k);
      if (!entity) continue;
      if (entity.deleted) patch.push({ op: "del", kind: entity.kind, id: entity.id });
      else patch.push({ op: "put", entity });
    }
    patch.sort((a, b) => {
      const va = a.op === "put" ? a.entity.version : 0;
      const vb = b.op === "put" ? b.entity.version : 0;
      return va - vb;
    });
    return {
      patch,
      cookie: this.seq,
      lastMutationID: this.clients.get(req.clientID) ?? 0,
    };
  };

  asTransport(): Transport {
    return { push: this.push, pull: this.pull };
  }
}

async function openEngine(server: FakeServer): Promise<Engine> {
  return Engine.open({
    storage: new MemoryClientStorage(),
    transport: server.asTransport(),
  });
}

describe("Engine — single client", () => {
  it("optimistically applies a mutation, then drops it from the outbox after sync", async () => {
    const server = new FakeServer();
    const eng = await openEngine(server);

    const wsId = uuidv7();
    await eng.mutate("createWorkspace", { id: wsId, name: "Acme" });

    expect(eng.get("workspace", wsId)?.name).toBe("Acme");
    expect(eng._peek().outbox).toHaveLength(1);

    await eng.sync();

    expect(eng.get("workspace", wsId)?.name).toBe("Acme");
    expect(eng._peek().outbox).toHaveLength(0);
    expect(eng.store.getState().cookie).toBeGreaterThan(0);
  });

  it("rebases: a later pull replaces the optimistic version with the authoritative one", async () => {
    const server = new FakeServer();
    const eng = await openEngine(server);
    const wsId = uuidv7();
    await eng.mutate("createWorkspace", { id: wsId, name: "Acme" });

    const optimistic = eng.get("workspace", wsId);
    expect(optimistic?.version).toBe(0); // optimistic stamp is 0

    await eng.sync();

    const confirmed = eng.get("workspace", wsId);
    expect(confirmed?.version).toBeGreaterThan(0); // server stamp
  });

  it("queues mutations offline and flushes them on the next sync", async () => {
    const server = new FakeServer();
    const eng = await openEngine(server);

    const wsId = uuidv7();
    const projectId = uuidv7();
    const issueId = uuidv7();

    // No sync between any of these — they queue in the outbox.
    await eng.mutate("createWorkspace", { id: wsId, name: "Acme" });
    await eng.mutate("createProject", { id: projectId, workspaceId: wsId, name: "Slipstream", key: "SL" });
    await eng.mutate("createIssue", {
      id: issueId,
      workspaceId: wsId,
      projectId,
      title: "Build the engine",
      position: between(null, null),
    });

    expect(eng._peek().outbox).toHaveLength(3);
    expect(eng.get("issue", issueId)?.title).toBe("Build the engine");

    await eng.sync();

    expect(eng._peek().outbox).toHaveLength(0);
    expect(eng.get("issue", issueId)?.version).toBeGreaterThan(0);
  });

  it("survives an unreachable transport: outbox grows, view stays consistent, recovers on next sync", async () => {
    const flaky: Transport = {
      push: async () => {
        throw new Error("offline");
      },
      pull: async () => {
        throw new Error("offline");
      },
    };
    const storage = new MemoryClientStorage();
    const eng = await Engine.open({ storage, transport: flaky });
    const wsId = uuidv7();
    await eng.mutate("createWorkspace", { id: wsId, name: "Acme" });
    await eng.sync(); // fails; engine flips to offline
    expect(eng.store.getState().online).toBe(false);
    expect(eng._peek().outbox).toHaveLength(1);
    expect(eng.get("workspace", wsId)?.name).toBe("Acme");
  });
});

describe("Engine — two-client convergence", () => {
  it("two clients with interleaved offline edits converge to identical state", async () => {
    const server = new FakeServer();
    const alice = await openEngine(server);
    const bob = await openEngine(server);

    // Both online: alice creates a workspace + project + initial issues
    const wsId = uuidv7();
    const projectId = uuidv7();
    await alice.mutate("createWorkspace", { id: wsId, name: "Acme" });
    await alice.mutate("createProject", { id: projectId, workspaceId: wsId, name: "Slip", key: "SL" });
    const i1 = uuidv7();
    const i2 = uuidv7();
    await alice.mutate("createIssue", { id: i1, workspaceId: wsId, projectId, title: "A1", position: "M0" });
    await alice.mutate("createIssue", { id: i2, workspaceId: wsId, projectId, title: "A2", position: "M5" });
    await alice.sync();
    await bob.sync();

    expect(bob.get("issue", i1)?.title).toBe("A1");
    expect(bob.get("issue", i2)?.title).toBe("A2");

    // Both clients edit offline.
    // alice moves i1 to done, bob marks i1 in_progress.
    // The server's total order resolves: last-write wins at mutation granularity.
    await alice.mutate("updateIssueStatus", { id: i1, status: "done" });
    await bob.mutate("updateIssueStatus", { id: i1, status: "in_progress" });

    // alice also adds a new issue while offline; bob adds a different one.
    const i3 = uuidv7();
    const i4 = uuidv7();
    await alice.mutate("createIssue", { id: i3, workspaceId: wsId, projectId, title: "A3", position: "MA" });
    await bob.mutate("createIssue", { id: i4, workspaceId: wsId, projectId, title: "B1", position: "MK" });

    // Alice syncs first, then bob. Bob's status update will land second, so
    // the converged status of i1 should be "in_progress".
    await alice.sync();
    await bob.sync();
    // Alice needs another pull to see bob's writes.
    await alice.sync();

    // Both clients see the same i1 status, the same set of issues, identical versions.
    expect(alice.get("issue", i1)?.status).toBe(bob.get("issue", i1)?.status);
    expect(alice.get("issue", i1)?.status).toBe("in_progress");

    expect(alice.get("issue", i3)?.title).toBe("A3");
    expect(alice.get("issue", i4)?.title).toBe("B1");
    expect(bob.get("issue", i3)?.title).toBe("A3");
    expect(bob.get("issue", i4)?.title).toBe("B1");

    // Outboxes are empty (everything confirmed).
    expect(alice._peek().outbox).toHaveLength(0);
    expect(bob._peek().outbox).toHaveLength(0);

    // Snapshot equality — the heart of the M2 "done when": both views match.
    expect(snapshot(alice)).toEqual(snapshot(bob));
  });

  it("repeated random interleaving still converges across three clients", async () => {
    const server = new FakeServer();
    const clients = [
      await openEngine(server),
      await openEngine(server),
      await openEngine(server),
    ];

    const wsId = uuidv7();
    const projectId = uuidv7();
    await clients[0]!.mutate("createWorkspace", { id: wsId, name: "Acme" });
    await clients[0]!.mutate("createProject", { id: projectId, workspaceId: wsId, name: "Slip", key: "SL" });
    await clients[0]!.sync();
    for (const c of clients) await c.sync();

    // Create 10 issues then run a randomised but seeded sequence of status
    // updates and syncs across clients.
    const issueIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = uuidv7();
      issueIds.push(id);
      await clients[0]!.mutate("createIssue", {
        id,
        workspaceId: wsId,
        projectId,
        title: `I${i}`,
        position: String.fromCharCode(65 + i),
      });
    }
    await clients[0]!.sync();
    for (const c of clients) await c.sync();

    // Deterministic PRNG so failures reproduce.
    let s = 0xdeadbeef;
    const rand = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return Math.abs(s) % 1_000_000;
    };
    const statuses: Array<"todo" | "in_progress" | "done"> = ["todo", "in_progress", "done"];

    for (let i = 0; i < 60; i++) {
      const c = clients[rand() % clients.length]!;
      const id = issueIds[rand() % issueIds.length]!;
      const st = statuses[rand() % statuses.length]!;
      await c.mutate("updateIssueStatus", { id, status: st });
      if (rand() % 3 === 0) await c.sync();
    }

    // Drain: sync each client until everything converges. Two passes is enough
    // because each pass guarantees the pusher's writes reach everyone next pass.
    for (let pass = 0; pass < 3; pass++) for (const c of clients) await c.sync();

    const snaps = clients.map(snapshot);
    expect(snaps[1]).toEqual(snaps[0]);
    expect(snaps[2]).toEqual(snaps[0]);
  });
});

function snapshot(eng: Engine): unknown {
  const view = eng.store.getState().view;
  return Array.from(view.entities.values())
    .filter((e: Entity) => !e.deleted)
    .map((e: Entity) => ({ kind: e.kind, id: e.id, version: e.version, body: e }))
    .sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
}
