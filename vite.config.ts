import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["spike/**/*.test.ts", "src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
