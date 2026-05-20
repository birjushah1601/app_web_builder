---
name: assemble-brief-cli-tool
description: Researcher fragment for cli-tool artifact kind — terminal CLIs, devtools, automation
activate_on: visualize
model_hint: haiku
---

# Assemble Brief — CLI Tools

Use this fragment when `designIntent.artifactKind === "cli-tool"`. Citations are well-known terminal CLIs and ink-based OSS examples — NOT landing pages, NOT API docs.

## Reference CLIs to cite for command-design patterns

- **gh CLI (cli/cli)** — gold standard for resource-oriented subcommand grouping (`gh repo create`, `gh pr list`, `gh issue close`). Hierarchical noun-then-verb structure scales to dozens of subcommands without users getting lost.
- **kubectl** — verb-first action vocabulary (`get`, `apply`, `delete`, `describe`, `logs`). Pair with consistent resource nouns (`pod`, `service`, `deployment`). Ideal when the CLI has many actions across few resource types.
- **fly CLI (flyctl)** — exemplary provisioning UX: status spinners while infra spins up, real-time progress prints, color-coded status (green check / yellow spinner / red X), terse but informative error messages with remediation hints.
- **vercel CLI** — best-in-class interactive prompts when arguments are missing (project pick, env-var input, deploy confirmation). Use `ink-text-input` and `ink-select-input` to mirror this pattern.
- **npm / bun CLI** — everyone's baseline; conservative output by default, `--json` flag for machine-readable, `--verbose` for debugging. Three output modes is plenty. Bun's own CLI (`bun run`, `bun test`, `bun install`, `bun build`) is the self-referential gold standard for "what does a Bun-native CLI feel like".

## Reference ink-based CLIs to cite for terminal-UI patterns

- **pastel** (vadimdemedes/pastel) — Next.js-style file-router framework for ink CLIs by ink's author. Read it to understand the conventional shape of a multi-screen ink app.
- **tasktimer** (rasaf-ibrahim/tasktimer) — small, polished ink CLI; good reference for a single-screen interactive UI with timer + keyboard handling.
- **terminal-image-cli** (sindresorhus/terminal-image-cli) — minimal, clean Commander + render-to-stdout pattern; good baseline for "no interactivity, just print well-formatted output".

## Quality bar

- **Subcommand grouping is intentional.** Either resource-noun-first (gh / vercel) OR verb-first (kubectl / npm) — pick one model and stick to it. Mixing the two confuses users.
- **Help output is readable.** Commander auto-generates `--help`; the description strings the developer writes ARE the docs.
- **Default output is terse.** Use `--verbose` / `-v` for debug noise; never default to chatty.
- **Errors have remediation.** Don't print `Error: file not found`. Print `Error: file not found at <path>. Did you mean to run 'atlas init' first?`.
- **Color is meaningful, not decorative.** Green = success / present; red = error / destructive; yellow = warning / in-progress; cyan = informational header. Use chalk for non-ink output and ink's `<Text color>` inside ink trees.
- **Interactive prompts only when arguments are missing.** Honour `--no-interactive` / `--yes` flags. Cite vercel's pattern.
- **Exit codes are deliberate.** 0 = success, 1 = generic failure, 2 = misuse (wrong args). Document the convention in `--help`.

## Anti-patterns

- Don't propose a CLI that requires a long-running daemon — keep the command surface request-response.
- Don't reach for ink for one-shot output (a `print version` doesn't need React) — chalk + `console.log` is fine; reserve ink for interactivity / multi-line live updates.
- Don't invent flag names that conflict with conventions — `--help`, `--version`, `--verbose`, `--quiet` MUST behave the way users expect.
- Don't ship a CLI without `--version` (the command should exit 0 even if no other config is set up).
- Don't write the CLI as if it's a web app — there's no port to bind to (the status page on port 3000 is sandbox plumbing, not part of the user's CLI).
