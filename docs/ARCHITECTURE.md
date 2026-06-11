# Slipstream — Architecture

> Status: M0 (scaffold + hello-world). Sections describing the engine, transport and UI describe the
> **target design**; the items not yet implemented are marked with `→ M{n}`.

This document is the system design write-up for Slipstream's sync engine. It is intentionally written
to stand on its own — readable without the code — because the design is half the portfolio value of
the project.

---

## 1. Problem

We want a collaborative issue tracker where:

- the UI reflects user actions **instantly**, even when offline,
- multiple clients **converge** to the same state after arbitrary edit interleavings,
- no mutation is lost, no client diverges permanently,
- the server's data store is authoritative and consistent (a transactional MongoDB),
- and accessibility is a property of the protocol, not just the markup — assistive tech can perceive
  the optimistic-to-confirmed sync lifecycle.

We deliberately exclude rich-text concurrent editing (a CRDT problem) — see §4.

## 2. The shape of the system

Three long-lived containers behind an existing Traefik proxy:

| Service | Role |
| --- | --- |
| `web` | Next.js App Router app. Marketing/landing/auth via RSC; the authenticated app is a client island that boots the sync runtime. |
| `sync` | Hono on Node. Owns the authoritative mutation log; runs mutators server-side inside MongoDB multi-document transactions. Exposes `/api/push`, `/api/pull`, and the `/api/sync` WebSocket. |
| `db` | MongoDB 8 as a single-node replica set. Transactions require a replica set; the single node keeps the homelab footprint honest. |

The browser talks to `tracker.hiten.dev` over TLS. Traefik routes:

- `/api/sync`, `/api/push`, `/api/pull` → `sync:8787`
- everything else → `web:3000`

Because the WebSocket is on the same origin as the cookie session, the upgrade authenticates
automatically with no separate token plumbing.

## 3. The sync engine

**Model: server-authoritative mutation log with optimistic client application and rebasing.** This is
the Replicache / Linear-class design, built by hand.

### 3.1 Mutations as first-class

Change is expressed as **named mutations**, not row writes. Each carries:

```ts
type Mutation = {
  id: number;        // client-local monotonic counter
  clientID: string;  // uuidv7 minted at first launch, persisted in IndexedDB
  name: string;      // "createIssue" | "updateIssueStatus" | "moveIssue" | …
  args: unknown;     // Zod-validated by the mutator
};
```

`id` is local-per-client; the global order is decided by the server's counter (§3.4).

### 3.2 Shared mutators (the elegant core)

Mutators are pure functions that take a transaction handle and the args:

```ts
// packages/protocol/src/mutators.ts → M1
export const mutators = {
  createIssue(tx, args) { /* … */ },
  updateIssueStatus(tx, args) { /* … */ },
  moveIssue(tx, args) { /* … */ },
  addComment(tx, args) { /* … */ },
  deleteIssue(tx, args) { /* tombstone */ },
};
```

The **same code** runs on the client (against an in-memory view) and on the server (against a MongoDB
session). The `tx` interface has just three methods — `get`, `put`, `del` — implemented twice. This
is the elegant core of the design: one definition, two execution sites, no drift possible.

### 3.3 Client lifecycle

1. **Optimistic apply.** A user action invokes the mutator locally against the current view, giving
   instant UI feedback.
2. **Outbox.** The mutation is appended to a persisted outbox (IndexedDB, survives reload and
   offline) and pushed when the network is available.
3. **Push response.** When the server confirms `lastMutationID`, the outbox drops everything
   `id <= lastMutationID`. The view is recomputed.
4. **Pull.** On poke (§3.5) or on an explicit refresh, the client `POST`s its last-seen `cookie`
   version. The server returns a patch of every changed entity since, plus the new `cookie` and the
   client's `lastMutationID`.
5. **Rebase.** The client applies the patch to its `serverBase`, drops confirmed mutations, and
   replays the rest. The materialised view is *always* `serverBase + unconfirmedOutbox`.

```ts
function recomputeView() {
  const view = structuredClone(serverBase);
  for (const m of outbox.pending) mutators[m.name](tx(view), m.args);
  store.setState(view);
}
```

**Rollback is free.** A rejected mutation is removed from the outbox; the next `recomputeView`
naturally lacks its effect. No special rollback path to maintain.

### 3.4 Server lifecycle — and how total order works

The push handler runs inside one MongoDB transaction:

```ts
await session.withTransaction(async () => {
  const client = await clients.findOne({ _id: clientID }, { session })
              ?? { lastMutationID: 0 };
  for (const m of mutations) {
    if (m.id <= client.lastMutationID) continue;            // idempotent replay
    if (m.id !== client.lastMutationID + 1) break;          // gap; wait

    const { seq: version } = await counters.findOneAndUpdate(
      { _id: "global" }, { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after", session },
    );

    runMutator(m.name, m.args, mongoTx(session, version));  // each put stamps entity.version
    client.lastMutationID = m.id;
  }
  await clients.updateOne(
    { _id: clientID }, { $set: { lastMutationID: client.lastMutationID } },
    { upsert: true, session },
  );
});
```

The `counters` document is the single source of global order. Two concurrent pushes both try to
`$inc` it, MongoDB detects the write conflict on one of them, that transaction retries, and the
result is a strict total order across all clients. Inside the transaction we never read the counter
from anywhere else; outside the transaction nobody mints versions. That invariant is what makes the
system correct.

The pull handler is a simple "give me every entity in my workspaces with `version > cookie`":

```ts
async function pull(clientID, cookieVersion) {
  const workspaces = await workspaceIdsFor(clientID);
  const changed = await entities.find(
    { workspaceId: { $in: workspaces }, version: { $gt: cookieVersion } },
    { readConcern: { level: "majority" } },
  ).toArray();
  const patch = changed.map((e) => e.deleted ? del(e) : put(e));
  const [{ seq: cookie } = { seq: 0 }] = await counters.find({ _id: "global" }).toArray();
  const client = await clients.findOne({ _id: clientID });
  return { patch, cookie, lastMutationID: client?.lastMutationID ?? 0 };
}
```

### 3.5 Poke and pull

The WebSocket carries one message type from the server: `poke`. On any successful push the server
notifies the workspace's connected clients. They each issue a pull. We deliberately do **not** send
the patch over the socket — pulls go over HTTPS so the protocol is debuggable with curl, and so the
socket can drop without losing data.

### 3.6 Offline and resume

The outbox and `serverBase` both live in IndexedDB. Cold starts read both from disk and recompute
the view before the network is consulted. The socket reconnects with backoff, the client pulls,
flushes the outbox, and is back to live.

## 4. Why server-ordered mutators, not CRDTs

For issue-tracker data — discrete fields like `status`, `assignee`, `position` — CRDTs are overkill
and underspecify intent. "Two people moved the same issue to different columns" is not a merge
problem; it is a last-write-in-server-order outcome, and the loser sees the winner's value on the
next pull. Server-ordered mutators give us:

- a **total order** that's trivial to reason about,
- **deterministic** convergence, provable by property tests,
- **no CRDT metadata** in the documents,
- and a clean upgrade path to per-field CRDTs *only* for fields that need them (rich-text
  description) later.

CRDTs are noted as a future extension, not a current scope item.

## 5. Data model

Client-mintable, time-sortable IDs (`uuidv7`) so the client can create entities offline. Soft-delete
via tombstones so deletes sync. Every document carries `version` (the global counter value at last
change) and `deleted`.

Entities (MVP): `Workspace`, `Membership`, `User`, `Project`, `Issue`, `Comment`, `Label`. Issue-to-label
is an embedded `labelIds: string[]` on the issue (document-store modelling), so there is no join
entity.

Server collections:

- `entities` — single collection keyed by `_id` with a `kind` discriminator, `workspaceId`, fields,
  `version`, `deleted`. Indexes: `{ workspaceId: 1, version: 1 }` (pull scan), `{ kind: 1, projectId: 1 }`
  (board/list reads).
- `clients` — `{ _id: clientID, lastMutationID }`.
- `counters` — `{ _id: "global", seq }`, `$inc`-ed inside the push transaction.

Ordering uses **fractional indexing** (a string key between neighbours) so `moveIssue` is a single
field change with no cascade — conflict-friendly because it leaves the rest of the column undisturbed.

## 6. Accessibility (a protocol property, not a finishing pass)

Treated as definition-of-done, not a phase:

- Keyboard-operable everywhere; visible focus from tokens; no keyboard traps except modal traps that
  Escape closes.
- Board drag-and-drop with `dnd-kit`'s keyboard sensor: Space to pick up, Arrow to move, Space to
  drop, Escape to cancel, with `aria-live` announcements.
- Command palette implements the WAI-ARIA combobox pattern with managed `aria-activedescendant`.
- Sync state lives in a polite live region — "syncing", "synced", "Issue Y updated by Alex" — so the
  optimistic-to-confirmed lifecycle is *perceivable*.
- Reduced-motion and forced-colors respected; `eslint-plugin-jsx-a11y` in lint; axe-core asserts zero
  violations per component; Playwright covers keyboard-only flows.

## 7. Testing strategy

- **Unit:** mutators (pure, trivially testable both sides), rebase logic, fractional indexing, Zod
  schemas. Vitest. → M1, M2
- **Engine property tests:** random interleavings of offline edits across N clients; assert
  convergence and no lost mutations. → M2
- **Server / transaction tests:** `mongodb-memory-server` started as a single-node replica set, so
  transactions work in CI without a service container. Cover idempotent replays, in-order gap
  handling, and the counter producing a strict total order. → M1
- **Component:** Testing Library + axe-core per component. → M4
- **E2E:** Playwright for multi-tab real-time, offline/reconnect, and keyboard-only journeys. → M5

## 8. Deployment

Single homelab box behind Traefik, joined to the existing `home-server_frontend` network. Cert
issuance uses the Cloudflare DNS-01 challenge already configured on that Traefik. Mongo runs as a
single-node replica set with `healthcheck` self-initiating `rs.initiate` on first run.

CI is GitHub Actions on hosted runners. Deploy is gated to `main` only — the runner joins the tailnet
over Tailscale OAuth and SSHes to the box. Self-hosted runners are deliberately not attached to this
public repo because forks could run arbitrary code on them.

If the homelab box goes dark, a drop-in swap is "always-on small host + free MongoDB Atlas tier";
the build is unchanged.

## 9. ADRs (placeholders, filled per milestone)

- **ADR-001 — Server-ordered mutators over CRDTs.** Discrete-field tracker data; total order is
  cheap; CRDT cost not earned. (Stub — fill in M1.)
- **ADR-002 — `entities` as one collection, not many.** One pull query becomes `version > cookie`;
  composite indexes serve the board/list reads. (Stub — fill in M1.)
- **ADR-003 — Pull is HTTPS, the socket carries only `poke`.** Debuggability and resilience over
  marginal latency. (Stub — fill in M3.)
- **ADR-004 — Domain on `hiten-patel.co.uk`, not `hiten.dev`.** Existing Cloudflare DNS challenge,
  wildcard A record already in place; no infra duplication for portfolio value. (Filled.)

---

*This document is intentionally checked in alongside the code and updated per milestone. If you are
reading the repo and want to know how a piece works, this is the place to start.*
