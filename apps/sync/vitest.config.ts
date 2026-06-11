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
  },
});
