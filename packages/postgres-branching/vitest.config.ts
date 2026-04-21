import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Tests share the same Postgres + clean up `br_*` schemas in beforeEach.
    // Parallel files cause cross-file cleanup to wipe in-flight branch schemas.
    fileParallelism: false
  }
});
