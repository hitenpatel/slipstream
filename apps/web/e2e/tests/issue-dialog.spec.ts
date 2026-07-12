import { test, expect } from "@playwright/test";

// Regression: clicking on the description textarea used to close the dialog
// because the fixed-position scrim close button was painted above the
// non-positioned dialog and captured every click inside it.
test("clicking the description field does not close the dialog", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `dialog-${suffix}@example.com`;

  await page.goto("/signup");
  await page.getByLabel(/display name/i).fill(`Dialog ${suffix}`);
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/password/i).fill("dialog-password-1234");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 15_000 });

  await page.getByRole("button", { name: /\+ new/i }).click();
  await page.getByPlaceholder("Project name").fill("Dialog project");
  await page.getByPlaceholder("KEY").fill("DLG");
  await page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]+$/, { timeout: 15_000 });

  const title = `Dialog issue ${suffix}`;
  const titleField = page.getByLabel(/new issue title/i);
  await titleField.fill(title);
  await titleField.press("Enter");

  // Open the card on the board (list view is virtualised).
  await page.goto(`${page.url()}/board`);
  const card = page.locator("article").filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: `Open ${title}` }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Clicking the description used to trigger the scrim close via CSS
  // stacking bug — dialog would disappear on this line.
  const description = dialog.getByPlaceholder(/add a description/i);
  await description.click();
  await expect(dialog).toBeVisible();

  // Typing should also work end-to-end (proves the click actually focused
  // the textarea, not a covering element).
  await description.fill("this description was typed inside the dialog");
  await expect(description).toHaveValue(/typed inside the dialog/);
  await expect(dialog).toBeVisible();
});
