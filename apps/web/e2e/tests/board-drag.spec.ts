import { test, expect } from "@playwright/test";

// Regression: after M8a, drag was scoped to a tiny 28px handle on the left
// edge of the card, which made desktop drag effectively unusable. Restoring
// whole-card drag: focusing the card and pressing Space picks it up,
// right-arrow moves it into the next column, Space drops.
//
// Keyboard drag is used here (rather than page.mouse) because dnd-kit's
// auto-scroll shifts the horizontal target coordinates during multi-step
// mouse moves — flaky in headless. Keyboard drag also verifies the
// accessibility path.
test("drag whole card across columns with keyboard", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  await page.goto("/signup");
  await page.getByLabel(/display name/i).fill(`Drag ${suffix}`);
  await page.getByLabel(/^email$/i).fill(`drag-${suffix}@example.com`);
  await page.getByLabel(/password/i).fill("drag-password-1234");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 15_000 });

  await page.getByRole("button", { name: /\+ new/i }).click();
  await page.getByPlaceholder("Project name").fill("Drag Project");
  await page.getByPlaceholder("KEY").fill("DRG");
  await page.getByRole("button", { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]+$/, { timeout: 15_000 });

  const title = `Drag issue ${suffix}`;
  const titleField = page.getByLabel(/new issue title/i);
  await titleField.fill(title);
  await titleField.press("Enter");

  await page.goto(`${page.url()}/board`);
  const backlogColumn = page.getByRole("region", { name: /^backlog$/i });
  const card = backlogColumn.locator("article").filter({ hasText: title });
  await expect(card).toBeVisible();

  // Focus the card (dnd-kit spreads role="button" tabindex="0" attributes),
  // press Space to pick up, arrow right to move into Todo, Space to drop.
  await card.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");

  const todoColumn = page.getByRole("region", { name: /^todo$/i });
  await expect(todoColumn.locator("article").filter({ hasText: title })).toBeVisible({
    timeout: 10_000,
  });
});
