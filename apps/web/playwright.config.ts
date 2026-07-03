import { defineConfig } from "@playwright/test";

// The e2e harness boots the full stack (Mongo replica set + sync + web) in
// global-setup and tears it down in global-teardown, so tests can drive real
// signup → mutate → pull flows against a live server. Everything is on
// loopback ports so it runs the same locally and in CI.
export default defineConfig({
  tsconfig: "./e2e/tsconfig.json",
  testDir: "./e2e/tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
