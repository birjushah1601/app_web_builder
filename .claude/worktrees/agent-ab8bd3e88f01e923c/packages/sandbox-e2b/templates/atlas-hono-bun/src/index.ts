import { Hono } from "hono";
import { logger } from "hono/logger";

/**
 * Atlas Sandbox — Bun + Hono entry point.
 *
 * Smoke endpoints:
 *   GET /         → app metadata
 *   GET /health   → liveness probe (used by E2B ready_cmd)
 *
 * Add new feature routes under src/routes/<feature>.ts and mount via
 * `app.route("/<prefix>", featureRouter)`.
 */
const app = new Hono();

app.use("*", logger());

app.get("/", (c) =>
  c.json({
    name: "Atlas Sandbox",
    version: "0.1.0",
    stack: "hono-bun",
  })
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    stack: "hono-bun",
    atlas: "sandbox-ready",
  })
);

// Bun.serve auto-runs when this file is executed via `bun run src/index.ts`.
// Hono exports `fetch` on the default export; Bun.serve picks it up.
const port = Number(Bun.env.PORT ?? 3000);

if (import.meta.main) {
  Bun.serve({
    port,
    fetch: app.fetch,
  });
  console.log(`atlas-hono-bun listening on http://0.0.0.0:${port}`);
}

export default app;
