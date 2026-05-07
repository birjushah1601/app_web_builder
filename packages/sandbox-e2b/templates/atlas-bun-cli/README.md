# atlas-bun-cli E2B template

Bun 1.2+ runtime + Commander 12.x + ink 5.x + chalk 5 + zod + bun:test.

Used by Atlas's developer role when the architect's `canvasManifest.artifactKind === "cli-tool"` AND `ATLAS_FF_MULTI_STACK=true`.

## Pre-installed runtime deps

- **bun** 1.2+ — runtime + package manager + bundler + test runner. Runs `.ts`/`.tsx` natively.
- **commander** 12.x — argv parsing; `program.command(...).description(...).action(...)` pattern.
- **ink** 5.x — React for CLIs (interactive terminal UIs via JSX).
- **ink-spinner** / **ink-text-input** / **ink-select-input** — common ink companions.
- **chalk** 5 — color primitives for non-ink code paths.
- **zod** 3.x — input validation for option schemas / config files.
- **@types/bun** + **@types/react** + **typescript** 5.6 — strict TS, `jsx: "preserve"`.
- **react** 18 — peer of ink.

## Preview surface (port 3000 is a status page, not a web UI)

CLIs don't have a web UI, but the sandbox iframe expects port 3000. The template ships a tiny **Bun.serve status page** on port 3000 (`src/server.ts`) that renders an ascii-art logo + "exercise via E2B Exec API; this preview is just a sandbox-alive indicator" hint. Acts as the "sandbox is alive" indicator inside the canvas.

The CLI itself is exercised via the **E2B Exec API** by the Developer role:

```ts
await sandbox.commands.run("bun run src/cli.ts hello --name world");
```

(A v2 polish plan will replace the static status page with an xterm.js-based terminal-emulator viewer that live-streams CLI output via WebSocket.)

## Out-of-the-box endpoints

- `GET /` — status page (ascii-art logo + usage hint)
- `GET /health` — `{"status": "ok", "stack": "bun-cli", "atlas": "sandbox-ready"}`

## Out-of-the-box subcommands

- `atlas help` — Commander auto-help
- `atlas --version` → `0.1.0`
- `atlas hello [name]` — ink demo (spinner → "Hello, world!")

## CLI usage via E2B Exec API

Because this sandbox is a CLI, Atlas does NOT navigate the iframe to interact with it. Instead, Atlas's Developer role spawns subcommands via the E2B SDK:

```ts
// inside an Atlas worker
const result = await sandbox.commands.run(
  "bun run src/cli.ts hello --name world",
  { cwd: "/code" }
);
console.log(result.stdout); // "Hello, world!"
console.log(result.exitCode); // 0
```

The status page on port 3000 is purely sandbox plumbing — it tells the canvas "yes, the sandbox booted" and renders the CLI's banner so the iframe isn't blank. Do not treat it as the user-facing UI.

## Conventions for the developer

- `src/cli.ts` — Commander root only; **no business logic**.
- `src/commands/<name>.tsx` — one file per subcommand; default-exports the ink component, named-exports `register<Name>(program)`.
- `src/lib/<helper>.ts` — pure helpers, no Commander references.
- Use `Bun.file(path)` / `Bun.write(path, data)` for IO, not `node:fs/promises`.
- Use `bun:test` for tests, not vitest/jest.
- Use `import.meta.main` to gate "run as binary" code so tests can import without side effects.

## Local smoke test (no E2B credit)

```bash
cd packages/sandbox-e2b/templates/atlas-bun-cli
./scripts/smoke-test-local.sh
```

Builds the image, starts the status page on port 3000, curls `/`, and execs the example `hello --name smoke` subcommand inside the container.

## Build + push to E2B

```bash
cd packages/sandbox-e2b/templates/atlas-bun-cli
export E2B_API_KEY=e2b_...
./scripts/build-template.sh
# Capture the printed template ID; add it to e2b.toml's template_id; commit.
```

## Wire into atlas-web

When `ATLAS_FF_MULTI_STACK=true` AND architect classifies the project as `cli-tool`, the sandbox factory routes provisioning to this template automatically. Per-project override via `ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-bun-cli`.
