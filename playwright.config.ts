import { defineConfig } from "@playwright/test";

// End-to-end tests run in Edge (the msedge channel), which needs no separate
// browser download. Playwright's Firefox doesn't start on the development
// machine (PROGRESS.md).
export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    channel: process.env.PW_CHANNEL ?? "msedge",
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  },
  webServer: {
    command: "npx vite --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
