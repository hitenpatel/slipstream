import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      // Only measure the bits we actually unit-test (palette logic + a11y
      // markup, KeepAlive). The Next route tree, RSC pages, and React UI
      // are exercised end-to-end by the live demo and (later) Playwright;
      // including them here would report a misleading low % for code that
      // is genuinely covered, just not by unit tests.
      // Only the files we genuinely unit-test. The rest of the UI is
      // covered end-to-end by the live demo (and, eventually, Playwright
      // keyboard-only flows). Reporting a low % across files that aren't
      // intended to be unit-tested would be misleading.
      include: [
        "app/app/palette/palette-search.ts",
        "app/app/keep-alive.tsx",
      ],
      exclude: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    },
  },
});
