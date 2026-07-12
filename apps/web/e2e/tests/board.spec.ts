import { test, expect } from "@playwright/test";

// Golden path: sign up a fresh user, create a project, create an issue, move
// it across board columns with the mobile-friendly status <select>. Exercises
// the sync push path end-to-end (mutator → Mongo transaction → pull → view).
test("signup → project → issue → move via status select", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-${suffix}@example.com`;
  const password = "e2e-password-1234";
  const displayName = `E2E ${suffix}`;

  await page.goto("/signup");
  await page.getByLabel(/display name/i).fill(displayName);
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /create account/i }).click();

  // Signup redirects to /app once the session cookie is set.
  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 15_000 });

  // Sidebar's "+ New" opens the project form.
  await page.getByRole("button", { name: /\+ new/i }).click();
  await page.getByPlaceholder("Project name").fill("E2E Project");
  await page.getByPlaceholder("KEY").fill("E2E");
  await page.getByRole("navigation", { name: "Projects" }).getByRole("button", { name: /^create$/i }).click();

  // AppHome auto-redirects to the first project once it appears in the view.
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]+$/, { timeout: 15_000 });

  // Create an issue from the list view. Submit with Enter — the placeholder
  // literally invites that, and it avoids the button-name collision with
  // the sidebar's project form.
  const title = `E2E issue ${suffix}`;
  const titleField = page.getByLabel(/new issue title/i);
  await titleField.fill(title);
  await titleField.press("Enter");

  // The list view uses a virtualised container that doesn't always measure
  // correctly in headless. The board view doesn't virtualise, so assert
  // there instead.
  const projectUrl = page.url();
  await page.goto(`${projectUrl}/board`);

  // Card is a draggable article with its title inside; find it by title.
  const card = page.locator("article").filter({ hasText: title });
  await expect(card).toBeVisible();

  // New issues start in "backlog"; move it to "in progress" via the per-card
  // status select. That's the mobile-friendly path added in M8a.
  await card
    .getByRole("combobox")
    .selectOption("in_progress");

  // Card should end up in the "In progress" column. Column is labelled by
  // its header <h2>; we assert the card lives under it.
  const inProgressColumn = page.getByRole("region", { name: /in progress/i });
  await expect(inProgressColumn.locator("article").filter({ hasText: title })).toBeVisible({
    timeout: 10_000,
  });
});
