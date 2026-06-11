# Slipstream — agent operating brief

## What this is
A local-first collaborative tracker on a hand-built sync engine. Read `docs/ARCHITECTURE.md` before
changing anything in `packages/protocol` or `packages/client`.

## Golden rules
- All data changes go through a mutator in `packages/protocol`. Never write entity state directly from
  UI or from a route handler. The mutator is the only writer.
- Client and server mutators are the SAME code. If you change a mutator, it must stay correct in both
  execution sites. Add a convergence test for any new mutator.
- The materialised view is always `serverBase + unconfirmedOutbox`. Do not mutate `serverBase` outside
  of `applyPatch` on pull. Do not mutate the view outside `recomputeView`.
- The push path runs entirely inside one MongoDB transaction (mutator writes, the `counters.$inc`,
  and the `lastMutationID` update). Never split it. The counter document is the single source of
  global order; do not mint versions any other way.
- Accessibility is part of done, not a later pass. New interactive UI ships keyboard-operable, with
  visible focus and any needed live-region announcements, or it does not ship.

## Conventions
- TypeScript strict, no `any`, no non-null assertions without a comment justifying them.
- UK English in all user-facing copy. No em dashes (use commas, full stops, parentheses).
- Conventional commits.
- Styling: design tokens as CSS custom properties + CSS Modules + cascade layers. No hardcoded
  colours or spacing.
- IDs are `uuidv7`, minted client-side, stored as the Mongo `_id`. Ordering uses fractional indexing.

## Commands
- `pnpm dev`            — web + sync in watch
- `pnpm turbo build`
- `pnpm turbo test`
- `pnpm turbo test:e2e`
- `pnpm turbo lint typecheck`

## Guardrails
- This is a PUBLIC repo. Assume everything committed is world-readable. Never commit secrets, private
  keys, or anything client-confidential. Secrets live in `.env` (gitignored) and GitHub Actions
  secrets; provisioning the real values is the repo owner's job, not the agent's.
- One milestone per branch, one PR per milestone. Open PRs with the `gh` CLI. Never push to `main`
  directly; never run the deploy step yourself.
- Do not weaken or bypass the auth/membership check to make a test pass.
- Do not add a SaaS sync provider (Liveblocks, Firebase, Yjs, hosted Replicache). Building the engine
  is the point.

## Deviations from the original PRD (intentional)
- Domain: `tracker.hiten-patel.co.uk` rather than `tracker.hiten.dev`. The existing Traefik on the
  host is wired with the Cloudflare DNS-01 challenge for the `hiten-patel.co.uk` zone, and a wildcard
  A record already resolves there. The PRD's "flip any of these in CLAUDE.md and the brief still
  holds" applies.
- Traefik network: `home-server_frontend` (the existing external network), entrypoint `web-secure`,
  cert resolver `myresolver`. Mirror this in any new compose labels.
- Next.js: 15.1.4 with React 19 at M0. The PRD's Next 16 / Cache Components / React Compiler upgrade
  is scheduled for M4 when the real app surface lands; don't drag it forward.

## Definition of done (per PR)
1. Typecheck, lint, unit, and relevant e2e pass.
2. New mutators have a convergence/property test.
3. New interactive UI passes axe and is fully keyboard-operable.
4. `docs/ARCHITECTURE.md` updated if the model or protocol changed.
