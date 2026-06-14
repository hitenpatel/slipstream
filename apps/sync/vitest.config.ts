import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Run each test file in its own process so the in-memory Mongo replica set
    // and the HTTP/WS server don't share lifecycle state between files.
    pool: "forks",
    poolOptions: { forks: { singleFork: false, isolate: true } },
    // Don't run files in parallel — keep deterministic ordering and avoid
    // port pressure when multiple Mongo instances boot.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test-helpers.ts",
        // dist isn't measured; the server entrypoint is exercised
        // indirectly via the http tests but its main() isn't reached
        // because we import without calling it.
      ],
    },
  },
});
