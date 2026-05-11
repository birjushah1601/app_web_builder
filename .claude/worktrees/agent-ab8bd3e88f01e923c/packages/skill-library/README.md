# @atlas/skill-library

Atlas's starter skill library — 40 OSS skills (Apache 2.0) authored by the Atlas team.

Skills are markdown files with YAML frontmatter, loaded at runtime by `@atlas/skill-runtime`. They describe **how** a role should handle a task, not implementation details. Skills auto-activate based on user intent (no slash commands for non-power users), compose cleanly, and are user-extensible.

## What's in the library

| Group | Count | Purpose |
|---|---|---|
| `architect/` | 5 | Brainstorm, spec-graph, runnable-plan, visualize-diff, approve-or-reject |
| `developer/` | 4 | TDD-feature, edit-only-what-changed, refactor, upgrade-dep |
| `debugger/` | 2 | Four-phase debug, incident response |
| `security/` | 4 | Audit RLS, CORS, secrets scan, CVE check |
| `accessibility/` | 4 | WCAG audit, RTL layout, keyboard nav, contrast check |
| `reviewer/` | 3 | Reviewer critique, PR summary, release notes |
| `ship/` | 4 | Domain/DNS/TLS, auth wire, payments wire, ship with rollback |
| `test-generators/` | 14 | One per node kind (page, route, component, client-state, model, endpoint, flow, auth-boundary, compliance, ai-feature, media-asset, design-token, dependency, test) |

## How to author a new skill

1. Pick the right group directory.
2. Create a `kebab-case.md` file. The filename stem must match the `name` field in frontmatter.
3. Populate the frontmatter:

```yaml
---
name: kebab-case
description: One-line summary ≤140 chars
activate_on: "some-intent-tag-or-pattern"   # recommended for most; required for test-generators
composes: ["other-skill-name"]              # optional
model_hint: "haiku" | "sonnet" | "opus"      # optional
---
```

4. Write the body: `# Title`, `## When to use`, `## Checklist`, optional `## Examples`, optional `## Anti-patterns`. Target 30-80 lines.
5. Run `pnpm -F @atlas/skill-library validate` to confirm the frontmatter parses and the file passes schema validation.

## Version pinning

Projects that want reproducible skill behaviour should commit `.atlas/skills/pin.json` (see `@atlas/skill-runtime`'s README for the schema). Weekly updates to the library may add or refine skills; the pin file fences a project to a known-good set.

## Release cadence

- **Weekly patch**: every Monday, auto-tagged `skill-library-vX.Y.Z+1` if any non-breaking change landed.
- **Monthly minor**: first of each month, `skill-library-vX.(Y+1).0`.
- **Breaking changes (major)**: batched quarterly, with a migration note in release notes.

The release workflow (`.github/workflows/skill-library-release.yml`) builds a tarball on tag push; the actual mirror to `github.com/atlas-labs/atlas-skills` is a manual step for v1 until the public repo is provisioned.

## License

Apache 2.0 — see `LICENSE`. Community contributions welcome via the public repo once live.
