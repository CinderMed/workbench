import { defineConfig } from "vitest/config";

// Used when running `pnpm --filter @cindermed/web test`; the root config defines the same project.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});
