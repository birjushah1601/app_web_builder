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

// Bun auto-serves `export default { fetch, port }` when this file is executed
// via `bun run src/index.ts`. Don't ALSO call Bun.serve(...) — that double-binds
// and EADDRINUSEs on the same port (since Bun.serve and auto-serve both try
// to bind {port}). Port 3001 default — the e2bdev/code-interpreter base image
// already binds :3000.
const port = Number(Bun.env.PORT ?? 3001);

console.log(`atlas-hono-bun listening on http://0.0.0.0:${port}`);

export default {
  port,
  fetch: app.fetch,
};
