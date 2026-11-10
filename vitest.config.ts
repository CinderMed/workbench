import { defineConfig } from "vitest/config";

const domainPackages = "packages/{model,fhir-defs,fml,normalizer,export}";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "packages", include: ["packages/*/src/**/*.test.ts"] } },
      {
        test: {
          name: "apps",
          include: ["apps/*/src/**/*.test.ts"],
          exclude: ["apps/web/**", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
          setupFiles: ["apps/web/src/test-setup.ts"],
        },
      },
      { test: { name: "tooling", include: ["tooling/**/*.test.ts"] } },
    ],
    coverage: {
      provider: "v8",
      // Test outputs never go to fixtures/: everything generated lands in .tmp/.
      reportsDirectory: ".tmp/coverage",
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/dist/**",
        "apps/*/src/server.ts",
        "apps/web/src/main.tsx",
        "apps/web/src/test-setup.ts",
      ],
      thresholds: {
        [`${domainPackages}/**`]: { lines: 90 },
        "packages/terminology/**": { lines: 90 },
        "apps/**": { lines: 70 },
      },
    },
  },
});
