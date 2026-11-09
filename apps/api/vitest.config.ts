import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./vitest.global-setup.ts"],
    // Tests share one database and truncate tables, so files run one at a time.
    fileParallelism: false,
  },
});
