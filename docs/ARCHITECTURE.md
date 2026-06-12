# Slipstream — Architecture (Backend & Protocol)

> Status (current): M0–M3 are shipped, M4a is in. The engine, the transport, the auth layer and the
> bootstrapped workspace are live at `tracker.hiten.dev`. Sections marked `→ M{n}` are still to come.

This document is the system design write-up for Slipstream's **sync engine, protocol, server, and
infrastructure**. It is intentionally written to stand on its own — readable without the code —
because the design is half the portfolio value of the project.

The **frontend** design (route tree, state model, RSC vs client island boundary, accessibility plan)
lives in a companion document: [`docs/FRONTEND.md`](./FRONTEND.md). The two are deliberately separate
so the protocol/engine layer can be read independently from the application that consumes it.

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

### 3.5 Poke, pull, presence

The WebSocket carries three message types from the server: `hello`, `poke`, and `presence`. The
client may publish one type back: `focus`.

- **`hello`** is sent on connect with the server's current cookie so a freshly-opened socket can
  decide whether to pull.
- **`poke`** is sent after any successful push. Connected clients each issue a pull.
- **`presence`** is sent whenever the workspace presence set changes (a peer joined, left, or
  changed focus). It carries the full deduplicated workspace snapshot — each user appears once with
  the focus from their most-recently-updated tab.
- **`focus`** is the client's way of saying "this is what I'm currently looking at". The server
  updates that socket's presence entry and re-broadcasts.

We deliberately do **not** send entity patches over the socket. Pulls go over HTTPS so the protocol
is debuggable with `curl`, and so the socket can drop without losing data. The socket is the *signal
plane*; the HTTPS endpoint is the *data plane*. Separating them keeps both small.

The upgrade itself is auth-gated against the session cookie — see §3.8. Anonymous connections are
refused with `HTTP 401`. Each authenticated socket carries `(userId, workspaceId)` for the lifetime
of the connection; the broker uses these to scope presence fan-out per workspace.

### 3.6 Offline and resume

The outbox and `serverBase` both live in IndexedDB. Cold starts read both from disk and recompute
the view before the network is consulted. The socket reconnects with backoff, the client pulls,
flushes the outbox, and is back to live. On reconnect the client also re-publishes its last `focus`
so the server's presence snapshot stays current after a dropped socket.

### 3.7 Presence

The presence broker is intentionally a thin layer over the WS registry:

```
PresenceBroker
  entries: Map<WebSocket, { session, email, focus, updatedAt }>
  add(socket, session, email)        // joins, fans out workspace snapshot
  remove(socket)                     // leaves, fans out workspace snapshot
  setFocus(socket, focus)            // idempotent on no-op transitions
  pokeAll(except?)                   // M3-era contract preserved
```

Two design choices worth calling out:

1. **In-process state.** Presence lives in the sync server's memory only. A restart drops every
   peer, which the client's reconnect + republish loop covers within a tick. Persisting presence to
   Mongo would let it survive a restart but cost a write per focus change, which buys nothing real.
2. **Most-recent-wins dedupe by `userId`.** A user with multiple tabs appears once in the snapshot,
   with the focus from whichever tab updated last. The alternative — one entry per tab — gives a
   noisier list with no useful information (no-one cares which tab the user is on, only what they're
   looking at).

The brief's "cursors on the board" item from §6 (Phase 2) is a future extension: add a `cursor`
field to `PresenceFocus`, throttle publishes, render on the board with a per-user colour. The
mechanism is the same.

### 3.8 Authentication on the WebSocket upgrade

Cookie sessions for HTTPS endpoints are unsurprising. The WebSocket needs the same gate:

- The browser sends the `slipstream_session` cookie with the upgrade request because the WS is on
  the same origin.
- The server parses the cookie, validates the session against the `sessions` collection, and looks
  up the email on the `accounts` collection. Either lookup failing means the upgrade is refused
  with `HTTP 401 Unauthorized` written directly to the raw socket before destruction.
- A successful auth captures `(session, email)` and passes them into `PresenceBroker.add(...)` so
  fan-out can be workspace-scoped without re-querying Mongo on every message.

This means the socket can no longer be opened by an anonymous probe — a useful invariant for the
M6a presence design, and a cheap defence against random load.

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

## 9. ADRs

Each ADR follows the same shape: **context**, **decision**, **consequences**, **alternatives
considered**. They're short on purpose — the prose above describes how things work; the ADRs
describe **why** they were chosen.

### ADR-001 — Server-ordered mutators over CRDTs

**Context.** Slipstream needs to converge across multiple offline clients with no permanent
divergence. The textbook answer for arbitrary collaborative state is a CRDT. The textbook answer is
not free.

**Decision.** Use a server-authoritative mutation log with shared deterministic mutators, and let
the server's transactional `$inc` of a global counter define total order. Conflicts resolve as
last-write-in-server-order-wins at mutation granularity.

**Consequences.**
- Trivial to reason about: every entity has exactly one `version`; replay a list of mutations
  against the same `serverBase` and you get the same result.
- No CRDT metadata in the documents — a Mongo `find()` returns plain entities a human can read in
  the shell.
- Deterministic convergence is provable by property test, which we do in
  `packages/client/src/engine.test.ts` ("three clients with random interleavings converge").
- "Two people moved the same issue to different columns" resolves as the *latest* mutation's
  effect; the loser sees the winner's value on the next pull. For discrete fields (`status`,
  `assigneeId`, `position`) this is the correct semantics. For free-form text it would not be — see
  ADR-001-future-extension below.

**Alternatives considered.**
- **Per-document CRDT (Automerge, Yjs).** Strictly more general but adds metadata to every
  document, complicates the Mongo storage story, and forces every operation through the CRDT layer
  even when discrete-field semantics would do.
- **Operational transform.** Older, narrower, even more bespoke than CRDTs. Worth the cost only for
  rich-text editing, which we're explicitly out of scope.

**Future extension.** A `description` field on `Issue` is the obvious candidate for collaborative
rich text. The path: introduce a per-field CRDT (Yjs document stored on the entity), keep
everything else under the server-ordered mutator rule. The discrete fields don't care; the
rich-text field gets the merge it needs.

### ADR-002 — `entities` as one collection, not many

**Context.** Mongo modelling for a tracker can go several ways: one collection per entity kind
(workspaces, projects, issues, …), one collection with a `kind` discriminator, or hybrid.

**Decision.** A single `entities` collection keyed by the entity's `_id` (the uuidv7 the client
minted), with a `kind` discriminator and a flat field set per kind.

**Consequences.**
- The pull becomes one query: `entities.find({ workspaceId: { $in: ws }, version: { $gt: cookie } })`.
  No `$lookup`, no fanning out across collections. The composite index
  `{ workspaceId: 1, version: 1 }` makes this an index scan over a small range.
- Adding a new entity kind is a Zod schema change in `packages/protocol` and a new mutator. No
  Mongo migration, no new collection to create or index.
- The Zod discriminated union (`EntitySchema`) means the type system reflects exactly the same
  shape as the Mongo document; no manual mapping.
- Cross-kind queries (e.g., "every entity under this project") are cheap because they're still in
  one collection.

**Alternatives considered.**
- **One collection per kind.** Idiomatic Mongo, but the pull becomes one query per kind, and the
  per-kind cookies would have to be reconciled. Lots of moving parts for no obvious win.
- **Embedded child entities.** Comments embedded in issues, issues embedded in projects. Pretty,
  but every mutation to a child rewrites the parent document, and the document-size ceiling is
  16MB. Bad path for anything but the smallest workspaces.

### ADR-003 — Pull is HTTPS; the socket carries only signals

**Context.** A WebSocket can carry data. It's tempting to put the patch on the socket and skip the
extra pull round-trip.

**Decision.** The socket carries `hello` / `poke` / `presence` and nothing else. Patches always
travel over `POST /api/pull` on HTTPS.

**Consequences.**
- The protocol is debuggable with `curl`. You can paste a session cookie into a one-liner and
  inspect exactly what a pull returns.
- A dropped socket loses zero data — the client reconnects, the server says "you might be behind",
  the client pulls. There's no "catch up the connection" code path.
- The socket is small enough to be obviously correct. Adding presence in M6a was 100 lines of
  server code because the broker is just a registry plus a fan-out.
- Latency cost: an extra round-trip per change. In practice the pull happens in single-digit
  milliseconds against the homelab box, and the engine renders the optimistic state before either
  trip completes, so the user-perceived latency is zero.

**Alternatives considered.**
- **Patches on the socket.** Lower theoretical latency, much more code: framing, retransmission
  when a pull replaces the socket as the recovery path, ordering against the cookie. Saves a
  round-trip we don't notice.
- **Long-polling / SSE.** Server-Sent Events would let us drop the bidirectional half but still
  need a sidecar for `focus` messages. The WS is one connection that does the whole job.

### ADR-004 — Domain on `hiten.dev`, served by Traefik on the homelab

**Context.** The brief specified `tracker.hiten.dev`. The user owns both `hiten.dev` and
`hiten-patel.co.uk`. Cloudflare DNS-01 is already wired on this box for the
`hiten-patel.co.uk` zone; `hiten.dev` resolves to a different box entirely.

**Decision.** Use `tracker.hiten.dev` (the brief's domain) with a new Cloudflare A record pointing
at this box's IP. The same Traefik resolver issues a fresh Let's Encrypt cert via DNS-01 — works
because the same Cloudflare token has access to both zones.

**Consequences.**
- Live demo URL matches the brief, no surprises on a portfolio link.
- One new A record, zero new infrastructure. The DNS challenge already covers the multi-zone case.
- Future-proof: pointing the record at a different IP swaps the demo host without any cert
  reissue work.

**Alternatives considered.**
- **`tracker.hiten-patel.co.uk` (the original detour).** No new DNS record needed because a
  wildcard A already resolved. Rejected at the user's request to stay faithful to the brief.
- **Run a parallel stack on the existing `hiten.dev` host.** Two infrastructures for the same
  service; rejected as gratuitous duplication.

### ADR-005 — WebSocket upgrades are auth-gated against the session cookie

**Context.** M0–M5 accepted any WebSocket upgrade on `/api/sync`. Adding presence (M6a) needs each
socket to know which user it belongs to so fan-out can be workspace-scoped without a per-message
lookup.

**Decision.** Authenticate the upgrade itself. The server reads the `slipstream_session` cookie
from the upgrade request, validates against the `sessions` collection, fetches the email from
`accounts`, and only then calls `wss.handleUpgrade(...)`. Anonymous upgrades get
`HTTP 401 Unauthorized` written directly to the raw socket before destruction.

**Consequences.**
- The socket's `(userId, workspaceId)` is stable for its whole lifetime. The broker stores them
  once at `add()` and doesn't touch Mongo again until presence-fan-out time (which only reads its
  own in-memory map).
- Cheap, durable invariant: there is no such thing as an unauthenticated `/api/sync` socket.
- A side-benefit defence: random WebSocket probes from the internet are rejected at handshake.

**Alternatives considered.**
- **Token-on-first-message.** Open anonymous, send a `{type:"auth", token}` first frame. Adds an
  ordering edge case (what if the client opens a focus message before the auth?) and means every
  message handler has to know whether the socket is authed.
- **Subprotocol with bearer in the WS protocol header.** Works but requires the client to grab the
  token at boot. Cookie reuse is simpler and matches the HTTPS endpoints.

### ADR-006 — Presence is an in-process broker, workspace-scoped, multi-tab dedupe

**Context.** "Who's looking at this issue?" needs to be cheap to compute, cheap to fan out, and
robust against a user with multiple tabs.

**Decision.** Keep presence in the sync server's memory only (`PresenceBroker.entries`). Fan out
on `add` / `remove` / `setFocus`. Dedupe by `userId` with most-recent-wins on `updatedAt`, so a
user with multiple tabs appears once with the focus from the most-recently-active tab.

**Consequences.**
- Zero database load for presence. Joining a workspace with N peers costs one in-memory iteration
  per fan-out, well under a millisecond even for hundreds of connections.
- A server restart drops every entry. Clients reconnect within their backoff window and re-publish
  their last `focus`, so the presence snapshot is rebuilt in tens of milliseconds.
- The single-process assumption is a real limit: scaling to multiple sync nodes would need a Redis
  pub/sub or NATS in front of the broker. That's documented as out of MVP scope and called out in
  the FRONTEND.md open questions.

**Alternatives considered.**
- **Persist presence to Mongo.** Survives a restart, but a write per focus change for no real
  benefit — the in-process state is already faster to rebuild than to query.
- **One entry per tab (no dedupe).** Easier to implement; gives the user a noisy "Alex (tab),
  Alex (tab), Alex (tab)" list with no useful information.

---

*This document is intentionally checked in alongside the code and updated per milestone. If you
are reading the repo and want to know how a piece works, this is the place to start.*
