# Slipstream — Frontend Design

> Companion to `docs/ARCHITECTURE.md`. That document covers the protocol and
> the server; this one covers everything from the user's browser inward.

This is the written design for the web app: the route tree, the state model,
the boundary between RSC and the client island, the auth flow, how the engine
reaches the components, the accessibility plan, and the open questions.

The diagrams in §0 are the canonical record — the prose that follows expands
on each of them. If a diagram and the prose disagree, the diagram wins and the
prose is the bug.

---

## 0. At a glance

Five diagrams, each answering one specific question. Mermaid renders natively
on GitHub.

### 0.1 State layers — where state lives and what triggers each layer

```mermaid
flowchart LR
  subgraph Browser["Browser tab"]
    direction TB

    subgraph DurableState["Durable state — survives reload"]
      direction TB
      IDB_Base["IDB · serverBase<br/>last authoritative snapshot<br/>(per-entity rows)"]
      IDB_Outbox["IDB · outbox<br/>unconfirmed mutations<br/>(ordered by client id)"]
      IDB_Meta["IDB · meta<br/>clientID, cookie,<br/>lastMutationID"]
    end

    subgraph EngineMem["Engine memory — in-process mirror"]
      direction TB
      Mem_Base["MemoryView serverBase<br/>(map keyed by kind:id)"]
      Mem_Outbox["outbox array<br/>(mirror of IDB outbox)"]
    end

    subgraph MaterialisedView["Materialised view — what UI subscribes to"]
      direction TB
      Store["zustand store · EngineState<br/>view = serverBase + outbox replays<br/>+ online, syncing, cookie, clientID"]
    end

    subgraph EphemeralState["Ephemeral UI state — local component"]
      direction TB
      Local["useState in pages<br/>· new-issue input value<br/>· create-project form open<br/>· status select focus<br/>(NEVER mirrors entity data)"]
    end

    IDB_Base -->|on open: read| Mem_Base
    IDB_Outbox -->|on open: read| Mem_Outbox
    Mem_Base -->|clone + replay outbox| Store
    Mem_Outbox -->|replay| Store
  end

  subgraph Server["Sync server"]
    Push["/api/push<br/>(transaction, $inc counter)"]
    Pull["/api/pull<br/>(patch since cookie)"]
    WS["WebSocket poke<br/>'something changed'"]
  end

  Store -->|UI handler calls<br/>engine.mutate| Mem_Outbox
  Mem_Outbox -->|appendOutbox| IDB_Outbox
  Mem_Outbox -->|engine.sync push| Push
  Push -->|lastMutationID| Mem_Outbox
  WS -->|onPoke<br/>engine.sync| Pull
  Pull -->|applyPatch| Mem_Base
  Mem_Base -->|putServerEntity| IDB_Base

  classDef durable fill:#1a3a52,stroke:#6ea8ff,color:#e6e8eb
  classDef memory  fill:#2a2f37,stroke:#9aa3ad,color:#e6e8eb
  classDef view    fill:#2d4a2d,stroke:#3fbf6c,color:#e6e8eb
  classDef ephemeral fill:#3a2a3a,stroke:#bf6eaa,color:#e6e8eb
  classDef server  fill:#14171c,stroke:#2a2f37,color:#e6e8eb

  class IDB_Base,IDB_Outbox,IDB_Meta durable
  class Mem_Base,Mem_Outbox memory
  class Store view
  class Local ephemeral
  class Push,Pull,WS server
```

**Invariants the diagram makes visible**:

1. There are exactly **four layers of state**: durable IDB, engine in-memory
   mirror, materialised view (computed), and ephemeral UI scratch.
2. Entity data **never** lives in `useState`. That layer is for input strings
   and "is this modal open" only.
3. There are exactly **two writers**: `engine.mutate` (appends to outbox) and
   `engine.applyPatch` (advances serverBase). Nothing else touches state.
4. The materialised view is a **computed** layer — not stored — so it can
   never drift from the inputs.

### 0.2 Route tree and the RSC ↔ client island boundary

```mermaid
flowchart TB
  Root["app/layout.tsx (RSC)<br/>html, body, tokens, globals"]
  Marketing["/ (RSC)<br/>marketing pitch + CTA"]
  Login["/login (RSC)<br/>auth gate inverse:<br/>redirect to /app if signed in"]
  Signup["/signup (RSC)<br/>auth gate inverse"]
  LoginForm["LoginForm (client)<br/>POST /api/auth/login"]
  SignupForm["SignupForm (client)<br/>POST /api/auth/signup"]

  AppGate["/app/layout.tsx (RSC)<br/>auth gate · redirect to /login on no cookie"]

  EngineProvider["EngineProvider (client)<br/>opens IDB(slipstream:userId),<br/>HttpTransport, WebSocketPokeChannel"]
  AppShell["AppShell (client)<br/>sidebar + content slot"]

  AppHome["/app/page.tsx (client)<br/>onboarding or auto-redirect to first project"]
  ProjectPage["/app/[projectId]/page.tsx (client)<br/>list view (M4b)"]
  Board["/app/[projectId]/board (client)<br/>board view (M4c)"]
  Detail["/app/[projectId]/[issueId] (client)<br/>issue detail overlay (M4c)"]

  AuthProxy["/api/auth/[...path]<br/>route handler · dev proxy only<br/>(Traefik in prod)"]

  Root --> Marketing
  Root --> Login --> LoginForm
  Root --> Signup --> SignupForm
  Root --> AppGate
  AppGate --> EngineProvider
  EngineProvider --> AppShell
  AppShell --> AppHome
  AppShell --> ProjectPage
  AppShell --> Board
  AppShell --> Detail

  Root --> AuthProxy
  LoginForm -.calls.-> AuthProxy
  SignupForm -.calls.-> AuthProxy

  classDef rsc fill:#1a3a52,stroke:#6ea8ff,color:#e6e8eb
  classDef client fill:#2d4a2d,stroke:#3fbf6c,color:#e6e8eb
  classDef proxy fill:#3a2a3a,stroke:#bf6eaa,color:#e6e8eb

  class Root,Marketing,Login,Signup,AppGate rsc
  class LoginForm,SignupForm,EngineProvider,AppShell,AppHome,ProjectPage,Board,Detail client
  class AuthProxy proxy
```

**Invariant**: nothing under `/app` is server-rendered with synced data. The
RSC layout's only job is the cookie check. Everything inside `EngineProvider`
is computed from the materialised view, in the browser.

### 0.3 Mutation lifecycle — what happens between a user click and another tab seeing the change

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Component<br/>(client)
  participant Engine as Engine<br/>(zustand + outbox)
  participant IDB as IndexedDB
  participant Sync as Sync server<br/>(/api/push, /api/pull)
  participant Mongo as MongoDB<br/>(replica set)
  participant WS as WebSocket<br/>broker
  participant Other as Other tab

  User->>UI: click "Create" / change status
  UI->>Engine: mutate("createIssue", args)
  Engine->>IDB: appendOutbox(mutation)
  Engine->>Engine: recomputeView()<br/>(replay outbox)
  Engine-->>UI: zustand notifies — re-render
  Note over UI: row appears with<br/>"pending" pill (version=0)

  UI->>Engine: sync()
  Engine->>Sync: POST /api/push {clientID, mutations[]}
  Sync->>Mongo: withTransaction:<br/>for each new mut: $inc counter, run mutator, stamp version<br/>upsert clients.lastMutationID
  Mongo-->>Sync: ok
  Sync->>WS: broker.pokeAll()
  Sync-->>Engine: { lastMutationID, cookie }
  Engine->>IDB: dropOutboxUpTo(lastMutationID)

  Engine->>Sync: POST /api/pull { cookie }
  Sync->>Mongo: find entities where version > cookie
  Mongo-->>Sync: patch
  Sync-->>Engine: { patch, cookie, lastMutationID }
  Engine->>IDB: putServerEntity for each
  Engine->>Engine: recomputeView()
  Engine-->>UI: zustand notifies — re-render
  Note over UI: row now has<br/>real version, badge gone

  WS-->>Other: poke
  Other->>Sync: POST /api/pull { cookie }
  Sync-->>Other: { patch, ... }
  Other->>Other: applyPatch + recomputeView
  Note over Other: same row appears<br/>within a tick of the original click
```

### 0.4 Auth flow

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Form as SignupForm<br/>(client)
  participant Web as web container<br/>(Next route handler)
  participant Sync as sync container<br/>(/api/auth/signup)
  participant Mongo as MongoDB
  participant Browser as Browser cookie jar
  participant Gate as /app layout (RSC)
  participant Engine as EngineProvider

  User->>Form: email + password + display name
  Form->>Web: POST /api/auth/signup
  Note over Web,Sync: In production Traefik routes /api/auth/*<br/>directly to sync. In dev this Next handler<br/>proxies through to SYNC_ORIGIN.
  Web->>Sync: POST /api/auth/signup
  Sync->>Sync: Argon2 hash password
  Sync->>Mongo: insert account
  Sync->>Sync: applyPush (createWorkspace + createProject)
  Sync->>Mongo: insert session row<br/>(expiresAt = now + 30d)
  Sync-->>Web: 200 + Set-Cookie<br/>slipstream_session=...<br/>HttpOnly · SameSite=Lax · Secure on https
  Web-->>Form: 200 + cookie
  Form->>Browser: cookie stored

  User->>Gate: navigate to /app
  Gate->>Sync: GET /api/auth/me<br/>Cookie: slipstream_session=...
  Sync->>Mongo: find session, validate expiresAt
  Sync-->>Gate: { user: { userId, email, workspaceId } }
  Gate->>Engine: render with me prop
  Engine->>Engine: openClientStorage("slipstream:{userId}")<br/>HttpTransport(""), WebSocketPokeChannel(wss)
  Engine->>Sync: first sync() — pull
  Sync-->>Engine: workspace + project (bootstrapped at signup)
```

### 0.5 Container view

```mermaid
flowchart LR
  subgraph Edge["Edge (Cloudflare DNS-01)"]
    DNS["tracker.hiten.dev<br/>A record"]
  end

  subgraph Host["Synology NAS — Docker host"]
    direction LR
    Traefik["Traefik 3<br/>routes by path:<br/>/api/sync, /push, /pull, /auth → sync<br/>everything else → web"]

    subgraph Stack["slipstream stack (this repo)"]
      direction TB
      Web["web<br/>Next.js standalone<br/>:3000<br/>marketing + auth + /app island"]
      SyncSvc["sync<br/>Hono on Node<br/>:8787<br/>/api/auth, /api/push, /api/pull, /api/sync (WS)"]
      Db["db<br/>MongoDB 4.4<br/>single-node replica set rs0<br/>:27017 (internal only)"]
    end
  end

  subgraph Client["Browser"]
    Tab["tab · client island<br/>Engine + IDB + WS"]
  end

  Tab -- "HTTPS" --> DNS
  DNS --> Traefik
  Traefik -- "Host(tracker.hiten.dev)<br/>+ PathPrefix(/api/*)" --> SyncSvc
  Traefik -- "Host(tracker.hiten.dev)<br/>default" --> Web

  Web -. "/api/auth proxy<br/>(dev only)" .-> SyncSvc
  Web -. "getMe SSR" .-> SyncSvc

  SyncSvc -- "rs0 mongo driver<br/>internal Docker net" --> Db

  classDef host fill:#1a3a52,stroke:#6ea8ff,color:#e6e8eb
  classDef stack fill:#2d4a2d,stroke:#3fbf6c,color:#e6e8eb
  classDef client fill:#3a2a3a,stroke:#bf6eaa,color:#e6e8eb
  classDef edge fill:#2a2f37,stroke:#9aa3ad,color:#e6e8eb

  class Traefik host
  class Web,SyncSvc,Db stack
  class Tab client
  class DNS edge
```

### 0.6 Presence and the WebSocket auth gate (M6a)

```mermaid
sequenceDiagram
  autonumber
  actor Alex
  actor Sam
  participant Browser_A as Alex's tab
  participant Sync as sync container<br/>/api/sync (WS)
  participant Mongo as MongoDB
  participant Browser_S as Sam's tab

  Alex->>Browser_A: open /app/[projectId]
  Browser_A->>Sync: WS upgrade<br/>Cookie: slipstream_session=...
  Sync->>Mongo: readSession + accounts lookup
  Mongo-->>Sync: { userId, workspaceId, email }
  Sync-->>Browser_A: 101 Switching Protocols
  Sync->>Browser_A: { type:"hello", clientID:"server", cookie }
  Sync->>Browser_A: { type:"presence", users:[ Alex@project ] }

  Note over Browser_A,Sync: ➜ usePublishFocus reads pathname<br/>and calls engine.publishFocus

  Browser_A->>Sync: { type:"focus", focus:{kind:"project", id} }
  Sync->>Sync: PresenceBroker.setFocus(socket, focus)
  Sync->>Browser_A: { type:"presence", users:[ Alex@project ] }

  Note over Browser_S: Sam was already connected,<br/>focused on the same project

  Sync->>Browser_S: { type:"presence", users:[ Alex@project, Sam@project ] }
  Browser_S->>Browser_S: render Alex's avatar on the project row

  Browser_A->>Browser_A: open issue overlay (?issue=ID)
  Browser_A->>Sync: { type:"focus", focus:{kind:"issue", id} }
  Sync->>Browser_S: { type:"presence", users:[ Alex@issue, Sam@project ] }
  Browser_S->>Browser_S: Alex's avatar moves to the issue detail dialog header

  Note over Browser_A,Sync: anonymous upgrade attempt (no cookie)<br/>is refused with HTTP 401 — see ADR-005
```

The corresponding state-layer change (§0.1):
`EngineState` gains `presence: PresenceUser[]` and `focus: PresenceFocus`; `presence` is
written by the `onPresence` channel handler, `focus` is mirrored by `engine.publishFocus`. The
`PresenceAvatars` component reads `presence` directly and filters by the current entity.

---

## 1. Goals (frontend-specific)

The brief's first principles — local-first, optimistic, offline-capable,
accessible by default — set the frontend goals directly:

1. **Instant.** Every user action takes effect locally before the server is
   consulted. A round-trip never blocks the UI.
2. **One source of truth.** Components read from a single materialised view
   (`serverBase + unconfirmedOutbox`) rather than fetching ad-hoc. There is no
   second cache that can drift.
3. **Accessible by default.** Keyboard operability and screen-reader awareness
   of the sync lifecycle ship with each component, not as a final pass.
4. **Cheap to add a view.** Board, list, palette, detail panel are all the
   same data viewed differently; adding "ordered by priority" or
   "grouped by assignee" should be a selector, not a backend change.

## 2. Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15.1 (App Router). Upgrading to 16 with Cache Components + React Compiler in M4d/M5. |
| Runtime | React 19. |
| State | The `@slipstream/client` Engine, exposed via `EngineProvider` + `useEngine()` + `useEngineState(selector)`. The Engine wraps a Zustand vanilla store and an IndexedDB-backed outbox. |
| Styling | Design tokens (CSS custom properties from `@slipstream/ui/tokens.css`) + CSS Modules + cascade layers. No hardcoded colours or spacing. |
| Routing | App Router file conventions. Marketing/auth are RSC; the authenticated app is a single client island that boots the engine. |
| Forms | Plain client components calling `fetch('/api/auth/*')` and `engine.mutate(...)`. Server Actions later if it earns its keep. |
| Lint | `next/core-web-vitals` + a future `eslint-plugin-jsx-a11y` pass (M5). |

## 3. Route tree

```
/                       RSC — marketing + pitch + CTA (signup/login or "open app")
/login                  RSC — redirects to /app if already authed; renders <LoginForm /> (client)
/signup                 RSC — redirects to /app if already authed; renders <SignupForm /> (client)
/app                    RSC layout wraps an AuthGate + EngineProvider + AppShell
  /app                  client — picks first project, redirects to /app/[projectId]
  /app/[projectId]      client — list view of issues
  /app/[projectId]/board client — board view (M4c)
  /app/[projectId]/[issueId] client — issue detail panel (M4c, modal-style overlay)
/api/auth/[...path]     Next route handler — proxies to the sync server's /api/auth/*
                        (only used by `next dev`; in production Traefik routes
                        /api/auth straight to the sync container)
```

**Hard rule**: nothing under `/app` is server-rendered with synced data. The
RSC layout's only job is the auth gate. Once it succeeds, the engine boots in
the browser and everything inside is computed from the materialised view.

Why: RSC over a local-first engine is the wrong shape. Server-rendering an
issue list means the server has to query the database for the same data the
engine is about to materialise client-side from IndexedDB — two sources, two
opportunities to disagree, no real benefit. The marketing page and the auth
flow stay RSC because they have no synced data to disagree about.

## 4. Auth flow

```
                  ┌─────────────────┐
                  │   /signup form  │ (client island)
                  └────────┬────────┘
                           │ POST /api/auth/signup
                           ▼
                  ┌─────────────────┐
                  │ Next route hand-│ (only on next dev; Traefik in prod)
                  │ ler proxies     │
                  └────────┬────────┘
                           ▼
                  ┌─────────────────┐
                  │ apps/sync/auth  │ — Argon2 hash, write account, push
                  │                 │   createWorkspace+createProject through
                  │                 │   the normal push path, mint session
                  │                 │   token, return Set-Cookie
                  └────────┬────────┘
                           ▼ cookie set by the browser
                  ┌─────────────────┐
                  │ /app layout RSC │ — getMe() reads cookie, calls /me on
                  │                 │   sync, redirects to /login if absent
                  └────────┬────────┘
                           ▼
                  ┌─────────────────┐
                  │ EngineProvider  │ — opens IndexedDB(slipstream:userId),
                  │                 │   wires HttpTransport + WS, syncs.
                  └─────────────────┘
```

- Sessions: opaque 32-byte hex token in an `httpOnly`, `SameSite=Lax` cookie,
  `Secure` auto-flagged on HTTPS, 30-day TTL with a Mongo TTL index that
  prunes expired rows.
- Passwords: Argon2 via `@node-rs/argon2` (native bindings — fast on the
  homelab arm64 and on amd64 CI).
- Logout: `DELETE` the session row, clear the cookie, hard-redirect to
  `/login` so the engine tears down and IndexedDB stops accepting writes for
  that user.
- IDB namespacing: each user gets their own database
  (`slipstream:${userId}`), so a sign-out followed by another account on the
  same machine doesn't cross the streams.

## 5. State model

The engine's materialised view *is* the application state. Components either:

- read entities by `(kind, id)` via `engine.get(kind, id)` (the helper on the
  engine), or
- read a slice of the store via `useEngineState((s) => s.online)` etc., or
- iterate `view.entities.values()` for list/board views, filtering and
  sorting in-memory (cheap — the entire workspace fits comfortably).

Components never write to state directly. UI handlers call
`engine.mutate(name, args)`, which:

1. Appends the mutation to the IndexedDB outbox.
2. Recomputes the view (replay over `serverBase`).
3. Returns immediately. The handler then calls `engine.sync()` to push.

```
UI handler
   │ mutate(name, args)
   ▼
Engine.mutate ──▶ storage.appendOutbox ──▶ recomputeView ──▶ zustand.setState
                                                                 │
                                                                 ▼
                                                       components re-render
   │ sync()
   ▼
Engine.sync ──▶ transport.push ──▶ server stamps version ──▶
                                                  │
                                                  ▼
                              transport.pull ──▶ applyPatch ──▶
                                                       │
                                                       ▼
                              outbox.dropConfirmed ──▶ recomputeView ──▶
                                                                 │
                                                                 ▼
                                                       components re-render
                                                       with confirmed version
```

UI signal of where each row is in this lifecycle: `version === 0` means
optimistic (server hasn't ack'd). The list view renders these with a pulsing
border + "pending" pill. Once the server stamps a real version (>= 1) on the
next pull, the optimistic row is replaced with the authoritative one and the
indicator disappears. Rollback is free: a rejected mutation simply disappears
from the outbox; the next `recomputeView` lacks its effect.

## 6. Component layering

```
app/layout.tsx (RSC, root)
  ├─ app/page.tsx (RSC, marketing)
  ├─ app/login/page.tsx (RSC) ── login-form.tsx (client island)
  ├─ app/signup/page.tsx (RSC) ── signup-form.tsx (client island)
  └─ app/app/layout.tsx (RSC, auth gate)
       └─ EngineProvider (client)
            └─ AppShell (client) — sidebar + content
                 ├─ /app/page.tsx (client) — onboarding / auto-redirect
                 ├─ /app/[projectId]/page.tsx (client) — list view
                 ├─ /app/[projectId]/board (client) — board view (M4c)
                 └─ /app/[projectId]/[issueId] (client) — detail panel (M4c)
```

- **Shell**: sidebar lists projects from the view, footer carries the sync
  badge and sign-out. The sidebar is always mounted so navigating doesn't
  re-boot the engine.
- **Sync badge**: `aria-live="polite"`, the live region announcing "syncing",
  "synced (v42)", "offline" as state changes. This is the optimistic-to-
  confirmed lifecycle made perceivable for AT users.
- **Optimistic markers**: per-row indicator on `version === 0` issues. The
  status select still works on these (replays through the outbox).

## 7. Accessibility plan

Treated as a definition-of-done property, not a phase. Per-component contract,
with milestone tags:

- ✅ **Keyboard everywhere** (M4c). Every action reachable; visible focus ring
  from tokens; logical tab order; modal focus traps that Escape closes (issue
  detail M4c, palette M4d).
- ✅ **Roving tabindex** on board columns and cards (M5). dnd-kit manages the
  sortable's tabIndex on the active draggable; the "Open" button inside the
  card is its own Tab stop so keyboard users can navigate without entering
  drag mode.
- ✅ **Board drag-and-drop, keyboard-operable** (M5). dnd-kit's KeyboardSensor —
  Space to grab, Arrow to move, Space to drop, Escape to cancel. Live-region
  announcements: "Grabbed *Polish login form*. In Backlog, position 3 of 7…",
  "*Polish login form*: In progress, position 1 of 4." (per move), "Dropped
  *Polish login form* in In progress.", "Cancelled. *Polish login form*
  returned to its original position."
- ✅ **Command palette** (M4d). WAI-ARIA combobox pattern with `role=combobox`,
  `aria-expanded`, `aria-controls`, `aria-activedescendant`,
  `aria-autocomplete=list`; listbox `role=listbox`; options `role=option` +
  `aria-selected`. Focus stays on the input.
- ✅ **Sync state** (M4d). srOnly polite live region (`role=status` +
  `aria-live=polite` + `aria-atomic=true`) that posts a fresh message *only*
  on a state transition (connecting → online, idle → syncing, syncing →
  synced(vN), online → offline) rather than every render.
- ✅ **Reduced motion** + **forced colors** (M5). `globals.css` switches
  `:focus-visible` to `Highlight` under `forced-colors`; per-component blocks
  cover the sync badge dot, active project link, toolbar filter chips,
  palette options, board cards, dialogs, optimistic markers, presence
  avatars, and close buttons.
- ✅ **Lint** (M5). `eslint-plugin-jsx-a11y` plugged into next-lint at
  `plugin:jsx-a11y/recommended`, with stricter overrides on
  `no-static-element-interactions` and `click-events-have-key-events`. The
  7 violations the plugin caught at first run are fixed.
- ✅ **Axe-core in CI** (M5). `palette-a11y.test.tsx` renders the palette's
  combobox markup with happy-dom + `@vitejs/plugin-react` +
  `@testing-library/jest-dom` and asserts zero violations across
  `wcag2a` / `wcag2aa` / `best-practice`; second test asserts
  `aria-activedescendant` always points at a real option id.
- ⏳ **Playwright keyboard-only journeys.** Deferred to M7 — needs a CI
  service container with Mongo for the full sign-up → keyboard flow.
- ⏳ **Manual NVDA + VoiceOver pass per release.** Documented as the gate
  before tagging a release.

## 8. Styling system

Design tokens live in `@slipstream/ui/tokens.css` and are exposed as CSS custom
properties under `:root`. CSS Modules consume them with no hardcoded values:

```css
.row {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
}
```

Cascade layers: `@layer reset, tokens, base, components, utilities` — keeps
the precedence story explicit so a future Tailwind v4 swap stays a one-line
flip. Dark mode comes from `color-scheme: dark light` + tokens defined for
both via `@media (prefers-color-scheme)`.

The CSS Module rule about local-only selectors means global element styles
(like `code { … }`) are scoped via `.panel :global(code)` or moved to a
`globals.css` `@layer base` block.

## 9. Performance plan

- **Activity-preserved view switching** ✅ *shipped M6b*. List + Board are both
  mounted by the project layout and toggled via `<KeepAlive>` (a manual
  equivalent of React 19.2's experimental `<Activity mode="hidden">` —
  visibility:hidden + inert + aria-hidden). Switching preserves scroll,
  filters, focus, in-flight DnD state, and the open detail dialog. Upgrade
  path to the stable `<Activity>` is a one-line swap in `keep-alive.tsx`
  when we move to React 19.2.
- **Virtualised list** ✅ *shipped M6b*. `@tanstack/react-virtual` wraps the
  list-view rows. 44px estimate, overscan 6, `getItemKey: issue.id`. The
  board view stays unvirtualised because per-column counts are bounded by
  the columns themselves.
- **`useEffectEvent` for WS / presence subscriptions.** Deferred until React
  19.2 lands stably; the current `useEffect` deps are stable enough that
  this is a micro-optimisation, not a correctness gate.

## 10. Open questions / future work

- ✅ **WebSocket session gating** *shipped M6a*. The upgrade itself is now
  auth-gated; anonymous upgrades get `HTTP 401`. See `docs/ARCHITECTURE.md`
  ADR-005.
- ✅ **Presence (who's-viewing)** *shipped M6a*. Workspace-scoped, multi-tab
  dedupe, focus published on every route change. See ADR-006.
- ✅ **Filters as URL state** *shipped M4c*. `?status=…&label=…&q=…` are the
  canonical filter representation; component state mirrors them and writes
  back via `router.replace` (debounced 200ms for the search box).
- ✅ **Issue detail navigation** *shipped M4c*. Detail is an overlay driven by
  `?issue=ID` so it stays shareable AND the underlying list/board keeps its
  scroll. Esc closes by clearing the param.
- ✅ **`<Activity>`-preserved view switching + virtualisation** *shipped M6b* —
  see §9.
- **Workspace permission enforcement on pull.** M6a closes the *transport*
  side: the socket can't be opened anonymously. The *data* side still trusts
  the cookie — `applyPush` and `pull` operate on the workspace the session
  declares. Future M7 work: derive the workspace scope from the session inside
  the handler and reject any mutation whose entities don't belong to it. This
  is a defence-in-depth item; the current behaviour matches the brief.
- **Multiple workspaces per user.** The data model already supports it via the
  `Membership` entity. UI work needed: a workspace picker, a `currentWorkspaceId`
  in the session, scoped IDB databases. Out of MVP.
- **Cursors on the board.** Add a `cursor: {x, y}` field to `PresenceFocus`,
  throttle publishes, render per-user cursors on the board with the
  deterministic colour-from-userId already used by the avatar chips. The
  mechanism is the same as M6a.
- **CSP / security headers at the web container level.** The existing
  Traefik pipeline adds `security-headers@file` which is enough for M6.
  Tightening the CSP for the client island is a future M7 item once the
  inline scripts from Next are stable.
- **Service worker for true offline.** The engine already opens instantly
  offline because IDB is the source of truth, but the *shell* (HTML/JS/CSS)
  still needs a network for the first hit. A small SW caching the static
  shell would close the loop. Deferred (M7+).
- **Horizontal scale-out of the sync server.** Per ADR-006, presence is
  in-process. Multi-instance presence needs a Redis pub/sub or NATS in front
  of the broker. Explicitly out of MVP per the brief.

## 11. Milestone slot-in

The MVP is now complete. PR-per-milestone, all merged onto `main`:

- ✅ **M4a** — auth, app gate, EngineProvider, "you're in" page (PR #4).
- ✅ **M4b** — sidebar shell, list view, create issue, status, delete (PR #5).
- ✅ **M4c** — board view, issue detail panel, comments, labels, filters (PR #7).
- ✅ **M4d** — command palette, sync-status live region (PR #8).
- ✅ **M5** — accessibility hardening: keyboard DnD with announcements,
  jsx-a11y, forced-colors, axe-core (PR #9).
- ✅ **M6a** — auth-gated WebSocket + workspace-scoped presence (PR #10).
- ✅ **M6b** — `<KeepAlive>` view switching + virtualised list (PR #11).
- ✅ **M6c** — docs polish: ADRs filled, ARCHITECTURE.md and FRONTEND.md
  refreshed, README finished as the front-door (this PR).
