import type { Server } from "bun";

const STATUS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Atlas CLI — Sandbox</title>
  <style>
    body {
      background: #0b0f17;
      color: #d6e3ff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box;
    }
    pre { color: #7dd3fc; line-height: 1.1; margin: 0 0 24px 0; }
    h1 { font-size: 18px; margin: 0 0 8px 0; color: #fafafa; }
    p  { margin: 4px 0; color: #94a3b8; }
    code { background: #1e293b; padding: 2px 6px; border-radius: 4px; color: #fde68a; }
  </style>
</head>
<body>
  <pre>
    ___   __  __                   ___ __    ____
   /   | / /_/ /___ ______       / (_) /   /  _/
  / /| |/ __/ / __ \`/ ___/______/ / / /    / /
 / ___ / /_/ / /_/ (__  )_____/_/ / /____/ /
/_/  |_\\__/_/\\__,_/____/      (_)_/_____/___/
  </pre>
  <h1>Atlas CLI v0.1.0</h1>
  <p>Atlas CLI v0.1.0 — exercise via E2B Exec API; this preview is just a sandbox-alive indicator.</p>
  <p>Try: <code>atlas help</code> or <code>atlas hello --name world</code></p>
  <p style="margin-top:24px;font-size:12px;">stack: bun-cli · status: <span style="color:#86efac">ok</span></p>
</body>
</html>`;

/**
 * Start the status-page HTTP server. Returns the Bun.Server handle so callers
 * (tests, the Dockerfile entrypoint) can stop it. Default port 3001 matches
 * the e2b.toml ready_cmd / start_cmd. (Port 3000 is taken by the e2bdev
 * code-interpreter base image, so Bun.serve EADDRINUSEs on 3000.)
 */
export function startServer(opts: { port?: number } = {}): Server {
  const port = opts.port ?? 3001;
  return Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({ status: "ok", stack: "bun-cli", atlas: "sandbox-ready" });
      }
      return new Response(STATUS_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
  });
}

if (import.meta.main) {
  const server = startServer({ port: Number(process.env.PORT ?? 3001) });
  console.log(`atlas-bun-cli status page → http://localhost:${server.port}/`);
}
