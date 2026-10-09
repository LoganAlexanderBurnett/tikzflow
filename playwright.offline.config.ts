import { defineConfig } from "@playwright/test";

// The service worker only exists in a production build, so these tests run
// against `vite preview` of a fresh build (npm run test:offline).
export default defineConfig({
  testDir: "test/offline",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5175",
    channel: process.env.PW_CHANNEL ?? "msedge",
    viewport: { width: 1400, height: 900 },
    serviceWorkers: "allow",
  },
  webServer: {
    command: "npm run build && npx vite preview --port 5175 --strictPort",
    url: "http://localhost:5175",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
