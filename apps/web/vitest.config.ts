import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
