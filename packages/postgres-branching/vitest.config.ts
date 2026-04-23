import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Defaults DATABASE_URL_TEST so the suite runs without per-shell env setup.
    globalSetup: ["./test/setup.ts"],
    // Tests share the same Postgres + clean up `br_*` schemas in beforeEach.
    // Parallel files cause cross-file cleanup to wipe in-flight branch schemas.
    fileParallelism: false
  }
});
