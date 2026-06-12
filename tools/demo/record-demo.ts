/**
 * Records the canonical README demo flow as a WebM video.
 *
 *   1. Sign up a fresh user with a timestamp-based email.
 *   2. Create three issues in the list view.
 *   3. Switch to the board view — should be instant because <KeepAlive> keeps
 *      both views mounted (the React 19.2 Activity pattern, manually).
 *   4. Move a card across columns using the keyboard sensor only:
 *      focus → Space (pick up) → ArrowRight (move) → Space (drop).
 *      This shows the dnd-kit a11y story.
 *   5. Open the command palette (Cmd-K), search, navigate to an issue.
 *   6. Edit the issue title in the detail dialog, close it.
 *
 * Target defaults to the live demo (https://tracker.hiten.dev). Override with
 *   SLIPSTREAM_URL=http://localhost:3000 pnpm record
 * if you're running the local docker stack.
 *
 * Runs in headed mode by default so the cursor is visible in the recorded
 * video. Set HEADLESS=1 to record headless (no cursor) — useful for CI.
 *
 * Output: ./out/<timestamp>/<context-id>.webm
 */

import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const TARGET = process.env.SLIPSTREAM_URL ?? "https://tracker.hiten.dev";
const HEADLESS = process.env.HEADLESS === "1";
const SLOW_MO = Number(process.env.SLOW_MO ?? 250);

const OUT_DIR = path.resolve("out", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(OUT_DIR, { recursive: true });

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: OUT_DIR,
      size: { width: 1280, height: 800 },
    },
    deviceScaleFactor: 2, // crisper text in the recording
  });

  const page = await context.newPage();
  const stamp = Date.now();
  const email = `demo-${stamp}@example.com`;

  try {
    await signup(page, { email, displayName: "Demo User" });
    await pause(page, 600);

    await createIssues(page, [
      "Wire up the architecture diagram",
      "Polish the marketing page",
      "Investigate the flaky socket test",
    ]);
    await pause(page, 800);

    await switchToBoard(page);
    await pause(page, 600);

    await keyboardMoveFirstCardRight(page);
    await pause(page, 800);

    await openPaletteAndJump(page, "polish");
    await pause(page, 800);

    await editTitleAndClose(page, "Polish the marketing page — and the README hero");
    await pause(page, 1200);
  } finally {
    await context.close(); // flushes the video
    await browser.close();
    console.log(`\nDemo recording saved under: ${OUT_DIR}`);
    console.log(`Convert to MP4 with ffmpeg if your host needs it:`);
    console.log(`  ffmpeg -i ${OUT_DIR}/<id>.webm -c:v libx264 -crf 20 demo.mp4`);
    console.log(`Or upload the .webm directly to Loom.`);
  }
}

async function signup(
  page: Page,
  { email, displayName }: { email: string; displayName: string },
): Promise<void> {
  await page.goto(`${TARGET}/signup`);
  await page.fill('input[autocomplete="name"]', displayName);
  await page.fill('input[autocomplete="email"]', email);
  await page.fill('input[autocomplete="new-password"]', "correct-horse-battery-staple");
  await page.click('button[type="submit"]');
  // /app gates on the cookie; redirects to the bootstrapped workspace
  await page.waitForURL(/\/app\//, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
}

async function createIssues(page: Page, titles: string[]): Promise<void> {
  const input = page.getByPlaceholder(/new issue title/i);
  for (const title of titles) {
    await input.click();
    await input.fill(title);
    await input.press("Enter");
    await page.waitForTimeout(200);
  }
}

async function switchToBoard(page: Page): Promise<void> {
  // The view switcher is rendered as a <Link>; clicking it doesn't remount
  // because KeepAlive keeps both views mounted in the project layout.
  await page.getByRole("link", { name: "Board" }).click();
  await page.waitForLoadState("networkidle");
}

async function keyboardMoveFirstCardRight(page: Page): Promise<void> {
  // Focus the first card in the Backlog column. dnd-kit puts the draggable
  // attributes on the article element; aria-roledescription is our hook.
  const firstCard = page
    .locator('[aria-roledescription="Draggable issue card"]')
    .first();
  await firstCard.focus();
  // Pick up
  await page.keyboard.press(" ");
  await page.waitForTimeout(300);
  // Move into the next column (Todo)
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  // Drop
  await page.keyboard.press(" ");
  await page.waitForTimeout(400);
}

async function openPaletteAndJump(page: Page, query: string): Promise<void> {
  // Cmd-K on Mac, Ctrl-K elsewhere. Playwright maps Meta to Cmd on Mac.
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+KeyK`);
  await page.waitForTimeout(300);
  await page.keyboard.type(query, { delay: 50 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
}

async function editTitleAndClose(page: Page, newTitle: string): Promise<void> {
  // The detail dialog's title input has the id from the aria-labelledby contract.
  const titleInput = page.locator("#issue-detail-title");
  await titleInput.waitFor({ state: "visible" });
  await titleInput.click({ clickCount: 3 }); // select all
  await titleInput.fill(newTitle);
  await titleInput.press("Enter"); // commits on Enter; the input blurs and updateIssue fires
  await page.waitForTimeout(600);
  // Close with Escape
  await page.keyboard.press("Escape");
}

function pause(page: Page, ms: number): Promise<void> {
  return page.waitForTimeout(ms);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
