# tools/demo

Playwright script that records the canonical README demo flow.

## What it does

Drives one Chromium tab through:

1. **Sign up** a fresh user with a timestamp-based email at the configured target.
2. **List view** — types and creates three issues so the list has content.
3. **Switch to Board** — should look instant because `<KeepAlive>` keeps both
   views mounted (the React 19.2 `<Activity>` pattern, manually).
4. **Keyboard DnD** — focuses the first card, presses `Space` to pick up,
   `ArrowRight` twice to move across columns, `Space` to drop. Demonstrates
   the dnd-kit accessibility story.
5. **Command palette** — opens with `Cmd/Ctrl-K`, types "polish",
   `Enter` to jump to the matching issue.
6. **Detail dialog** — selects the title, types a new one, `Enter` to commit
   (the input commits on Enter and blurs, firing `updateIssue` through the
   engine), `Escape` to close.

Output is a WebM video under `out/<timestamp>/`.

## Running it

```bash
# From the repo root, on a host with a display (Mac / Linux desktop):
pnpm install                                      # picks up @slipstream/demo
pnpm --filter @slipstream/demo install:chromium   # one-time Chromium download
pnpm --filter @slipstream/demo record             # records against tracker.hiten.dev

# Or against a local docker stack:
SLIPSTREAM_URL=http://localhost:3000 pnpm --filter @slipstream/demo record
```

Default mode is headed (browser window visible) so the cursor is recorded.
Set `HEADLESS=1` for unattended runs — the video will not show the cursor.

`SLOW_MO` controls the pace between Playwright actions (default 250 ms). Pump
it up to 400 if the recording feels rushed.

## Uploading to Loom

Loom accepts video uploads — drag the `out/<timestamp>/*.webm` into a new
Loom video, trim if needed, set to public unlisted, copy the share URL.

The repo `README.md` has a placeholder for the Loom link in the
"Watch a 30-second demo" section near the top — just swap the URL.

## Tips

- If the signup form is rejected (the live demo is shared with other testers
  and the email collisions get noisy), the script uses a timestamp-based
  email so it should never collide. If it does, re-run.
- The script targets selectors by their accessible names (`role`,
  `aria-roledescription`, `getByPlaceholder`) so it stays robust to CSS-class
  churn — touch the same accessibility contract that ships to users.
- If the keyboard DnD step doesn't visibly move the card, increase
  `SLOW_MO` so the dnd-kit announcements get a chance to fire and the
  card has time to animate.
