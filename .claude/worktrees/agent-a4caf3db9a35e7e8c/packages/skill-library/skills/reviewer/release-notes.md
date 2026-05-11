---
name: release-notes
description: Generate user-facing release notes from a batch of merged PRs
activate_on: "release"
model_hint: sonnet
---

# Release Notes

## When to use

Called before every tagged release (weekly patch cadence per Unit C OQ4).

## Checklist

- [ ] Group changes by audience: "For builders", "For developers", "For platform admins".
- [ ] Lead with user-visible changes. Omit internal refactors unless they affect behaviour.
- [ ] Highlight breaking changes with a ⚠ marker + migration note.
- [ ] Credit external contributors by GitHub handle.

## Anti-patterns

- Do not publish "various improvements and bug fixes" — name them.
