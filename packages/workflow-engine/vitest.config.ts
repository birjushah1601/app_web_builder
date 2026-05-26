import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Integration tests share Postgres tables (workflow_runs, workflow_nodes)
    // and run TRUNCATE in beforeEach. Parallel execution across test files
    // causes FK violations when one file truncates while another inserts.
    // Run all test files sequentially (single worker thread) to avoid conflicts.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  }
});
