import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke test of the local mode (#187): the real dev server on 127.0.0.1, the real worker and
 * the real FHIR definition index (written by the global setup with `cindermed fhir-index`).
 * Chromium only. Outputs go to .tmp/ (git-ignored).
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "../../.tmp/e2e/results",
  reporter: [["list"], ["html", { outputFolder: "../../.tmp/e2e/report", open: "never" }]],
  timeout: 120_000,
  retries: 0,
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node node_modules/vite/bin/vite.js",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
