import { defineConfig } from "vitest/config";

export default defineConfig({
  // Plan D.4 — graphql ships both CJS and ESM entry points. When the
  // `@graphql-codegen/*` plugins `require("graphql")` while our source
  // `import`s it, Vite resolves two different Module instances and
  // `instanceof` checks inside graphql (e.g. `isSchema`) fail with the
  // famous "from another module or realm" error. Deduping forces a single
  // resolution across both paths.
  resolve: {
    dedupe: ["graphql"]
  },
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
    },
    // Plan D.4 — keep graphql (and the graphql-codegen plugins that import
    // it) inlined so vite's dedupe applies. Without this, vite externalizes
    // node_modules and the plugins resolve to a second "graphql" instance,
    // tripping instanceof checks inside graphql ("from another module or
    // realm" errors).
    server: {
      deps: {
        inline: [
          "graphql",
          /^@graphql-codegen\//,
          /^@graphql-tools\//
        ]
      }
    }
  }
});
