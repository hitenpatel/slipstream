import { test, expect } from "@playwright/test";

test("landing page renders and offers signup", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Slipstream/i);
  // Both auth entry points are on the landing; asserting the signup CTA is
  // enough — that's the flow a new visitor takes.
  await expect(page.getByRole("link", { name: /create an account/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
});

test("sync server healthcheck is up", async ({ request }) => {
  // Hits the sync process directly on its port (Next doesn't rewrite
  // /api/sync/*, only /api/push and /api/pull).
  const res = await request.get("http://127.0.0.1:8788/api/sync/health");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; service: string };
  expect(body.ok).toBe(true);
  expect(body.service).toBe("slipstream-sync");
});
