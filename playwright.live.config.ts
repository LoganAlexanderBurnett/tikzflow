import { defineConfig } from "@playwright/test";

// The post-deploy checks (D76): the same app, on the real host. No server is started.
//   npm run test:live                      (https://tikzflow.pages.dev)
//   TIKZFLOW_URL=https://example.pages.dev npm run test:live
export default defineConfig({
  testDir: "test/live",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.TIKZFLOW_URL ?? "https://tikzflow.pages.dev",
    channel: process.env.PW_CHANNEL ?? "msedge",
    viewport: { width: 1400, height: 900 },
    serviceWorkers: "allow",
  },
});
