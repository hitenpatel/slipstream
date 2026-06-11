# Slipstream

> **Local-first sync, built from scratch.** Optimistic mutations on the client, a server-authoritative
> mutation log on the server, deterministic rebasing on every pull, and a single MongoDB transaction
> with a global counter that serialises concurrent writes into one total order. The issue tracker on
> top is the demo — the engine is the work.

**Live:** [tracker.hiten-patel.co.uk](https://tracker.hiten-patel.co.uk) ·
**Design write-up:** [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)

---

## The pitch in one paragraph

This is a local-first collaborative issue tracker on a hand-built sync engine. The interesting work
is the sync layer: named mutations on the client are optimistically applied against a materialised
view backed by an IndexedDB outbox, then pushed to a Node sync server that runs the **same mutator
code** authoritatively inside a MongoDB multi-document transaction. A single `counters` document is
`$inc`-ed inside that transaction to mint a global version, which gives every change a total order.
Other clients are poked over WebSocket, pull a patch since their last-seen version, drop confirmed
mutations from their outbox, and rebase the rest on top. Conflicts resolve as
last-write-in-server-order-wins at mutation granularity, every client converges, and rollback is
free because rejected mutations simply leave the outbox. The tracker — board, list, palette,
keyboard-operable drag and drop, accessible live-region announcements for the optimistic-to-confirmed
sync lifecycle — is the surface that proves it.

The model is the one Replicache and Linear use. The point of this repo is that the engine is
designed and built here, not bought in.

## Why this exists

- A non-vendor implementation of a hard, real distributed-systems pattern, owned end-to-end.
- A genuine MongoDB use case — multi-document transactions, an idempotent push log, total ordering —
  rather than CRUD over a document store.
- Accessibility treated as a property of the design, not a finishing pass. The optimistic-to-confirmed
  sync lifecycle is *perceivable* to screen-reader users, and the board's drag-and-drop is fully
  keyboard-operable.

## Architecture at a glance

```
                ┌─────────────────────────────────────────────────────────┐
                │              tracker.hiten-patel.co.uk                  │
                │              (Traefik · Let's Encrypt DNS-01)           │
                └────────────┬────────────────────────────┬───────────────┘
                             │ /api/sync,push,pull        │ everything else
                             ▼                            ▼
                       ┌──────────┐                ┌──────────┐
                       │   sync   │                │   web    │
                       │  (Hono)  │                │ (Next 15) │
                       │  :8787   │                │  :3000   │
                       └─────┬────┘                └────┬─────┘
                             │ transactional push       │
                             ▼                          │
                       ┌──────────────────┐             │
                       │ MongoDB (rs0)    │◀────────────┘  // for server reads in
                       │ entities, counters,│              // RSC routes that need it
                       │ clients          │
                       └──────────────────┘
```

The client side is a `Zustand` materialised view computed as `serverBase + unconfirmedPending`. The
outbox and base cache live in IndexedDB so the app opens instantly offline. The WebSocket carries
nothing but `poke` (and presence later) — pulls go over HTTPS, which keeps the protocol debuggable.

Read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full design, the CRDT-vs-server-order
tradeoff, the failure modes, and the ADRs.

## Repository layout

```
slipstream/
  apps/
    web/                 # Next.js (App Router) — landing + auth + the tracker UI
    sync/                # Hono server — owns the mutation log and reconciliation
  packages/
    protocol/            # entities, mutators, Zod schemas, protocol types (shared FE+BE)
    client/              # sync runtime: store, outbox, transport, rebase loop
    ui/                  # tokens + accessible primitives
  infra/
    Dockerfile.web
    Dockerfile.sync
    docker-compose.yml   # web + sync + Mongo (single-node replica set)
  .github/workflows/
    ci.yml               # typecheck · lint · test · build · docker · deploy
  docs/
    ARCHITECTURE.md      # the written system design
  CLAUDE.md              # how the autonomous agent should treat this repo
```

## Milestones (one reviewable PR each)

| Milestone | Scope | Done when |
| --- | --- | --- |
| **M0** | Scaffold, Dockerfiles, compose, Traefik labels, CI | Green pipeline; hello-world over HTTPS at the demo URL; sync answers `/api/sync/health`. |
| **M1** | Mongo collections, entities, mutators, `/api/push` + `/api/pull` with server tests | Push is idempotent + in-order inside a transaction; pull returns a correct patch since cookie; replays are no-ops. |
| **M2** | Client runtime: Zustand store, IndexedDB outbox, optimistic apply, rebase loop | Two simulated clients converge to identical state after interleaved offline edits. |
| **M3** | WebSocket transport, poke-and-pull, reconnect with resume | Edit in one tab appears in another within a tick; dropped sockets recover without lost mutations. |
| **M4** | Tracker UI MVP — auth, projects, issues, board, list, palette, comments, labels | The MVP feature list works end-to-end, optimistic and live. |
| **M5** | Accessibility — keyboard DnD with announcements, palette combobox, live regions, axe-clean | Zero axe violations, full keyboard operability, NVDA / VoiceOver pass clean. |
| **M6** | Presence, polish, the front-door | Presence is smooth, large boards stay responsive, the architecture doc reads standalone. |

## Running it locally

```bash
pnpm install
pnpm dev                 # web on :3000, sync on :8787
```

For the full stack with Mongo:

```bash
cp .env.example .env
# fill in SESSION_SECRET; you can generate one with `openssl rand -hex 32`
docker compose -f infra/docker-compose.yml up --build
```

## Deployment

The production stack runs on a homelab box behind an existing Traefik instance, joined to the
`home-server_frontend` network. Certificates are issued via the Cloudflare DNS-01 challenge already
configured on that Traefik, so `tracker.hiten-patel.co.uk` gets a real cert with no extra config.

Deploy is GitHub Actions on `main` only — fork PRs can't reach the box because the deploy step is
gated to `refs/heads/main`. The hosted runner joins the tailnet over Tailscale OAuth, SSHes to the
box as the `deploy` user, and runs `docker compose up -d --build`. Self-hosted runners are
deliberately not attached to this public repo (forks could run code on them).

> **Deviation from the PRD:** the live demo is on `tracker.hiten-patel.co.uk`, not `tracker.hiten.dev`.
> The Traefik instance and Cloudflare DNS challenge are already wired for the `hiten-patel.co.uk`
> zone; pointing at a different zone would mean parallel infra for no portfolio value. The build,
> code and protocol are unchanged.

## License

MIT — see [`LICENSE`](./LICENSE).
