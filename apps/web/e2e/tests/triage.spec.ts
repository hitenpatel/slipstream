import { test, expect } from "@playwright/test";

// AI triage golden path against the deterministic stub provider (set via
// TRIAGE_PROVIDER=stub in global-setup): open an issue, request a suggestion,
// watch the rationale stream in, accept the label + priority parts, and see
// the issue update through the normal mutator path. Also checks the
// duplicate link swaps the dialog to the sibling issue.
test("triage suggests, accepts apply through sync, duplicate link navigates", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  await page.goto("/signup");
  await page.getByLabel(/display name/i).fill(`Triage ${suffix}`);
  await page.getByLabel(/^email$/i).fill(`triage-${suffix}@example.com`);
  await page.getByLabel(/password/i).fill("triage-password-1234");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 15_000 });

  await page.getByRole("button", { name: /\+ new/i }).click();
  await page.getByPlaceholder("Project name").fill("Triage project");
  await page.getByPlaceholder("KEY").fill("TRI");
  await page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]+$/, { timeout: 15_000 });

  // Two issues sharing a 5+-char title word so the stub flags a duplicate.
  const titleA = `Reconnect loop after sleep ${suffix}`;
  const titleB = `Reconnect handshake stuck ${suffix}`;
  const titleField = page.getByLabel(/new issue title/i);
  await titleField.fill(titleA);
  await titleField.press("Enter");
  await titleField.fill(titleB);
  await titleField.press("Enter");

  // Open issue A on the board (list view is virtualised).
  await page.goto(`${page.url()}/board`);
  const cardA = page.locator("article").filter({ hasText: titleA });
  await expect(cardA).toBeVisible();
  await cardA.getByRole("button", { name: `Open ${titleA}` }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Create a label so the stub has something to suggest; creating it does
  // NOT apply it to the issue.
  await dialog.getByLabel(/new label name/i).fill("performance");
  await dialog.getByRole("button", { name: /^add$/i }).click();

  await dialog.getByRole("button", { name: /^suggest$/i }).click();

  // Stub streams a rationale, then the parsed suggestion appears.
  await expect(dialog.getByText(/stubbed rationale/i)).toBeVisible({ timeout: 15_000 });
  const addLabel = dialog.getByRole("button", { name: /add label “performance”/i });
  const setPriority = dialog.getByRole("button", { name: /set priority to medium/i });
  await expect(addLabel).toBeVisible();
  await expect(setPriority).toBeVisible();

  // Duplicate suggestion points at issue B.
  await expect(dialog.getByText(/possible duplicates/i)).toBeVisible();
  const dupLink = dialog.getByRole("button", { name: titleB });
  await expect(dupLink).toBeVisible();

  // Accept the label — the chip toggles on and the accept button disables.
  await addLabel.click();
  await expect(dialog.getByRole("button", { name: /label “performance” added/i })).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: /^performance$/i, pressed: true }),
  ).toBeVisible();

  // Accept the priority — the select reflects it and the button disables.
  // (The Field's wrapping <label> folds the selected option into the select's
  // accessible name, so locate structurally rather than by label.)
  await setPriority.click();
  const prioritySelect = dialog.locator("label", { hasText: "Priority" }).locator("select");
  await expect(prioritySelect).toHaveValue("3");
  await expect(dialog.getByRole("button", { name: /priority set to medium/i })).toBeDisabled();

  // Duplicate link swaps the dialog to the sibling issue.
  await dupLink.click();
  await expect(dialog.getByLabel(/issue title/i)).toHaveValue(titleB, { timeout: 10_000 });
});
