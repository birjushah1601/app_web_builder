import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    globalSetup: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 20_000,
    fileParallel: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true }
    }
  }
});
