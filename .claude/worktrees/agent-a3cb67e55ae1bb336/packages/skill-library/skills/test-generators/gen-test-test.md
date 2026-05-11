---
name: gen-test-test
description: Meta — generate a sanity test for a Test node itself (it runs, it reports)
activate_on: "node:test"
model_hint: haiku
---

# Generate Test — Test

## When to use

Auto-activated when a `Test` node is added. This is a meta-generator: the Test node represents a test that exists in the test suite; this generator verifies the Test node itself is wired into CI.

## Checklist

- [ ] Discovery test: the Test node's file path exists in the repo.
- [ ] Execution test: running the test via `pnpm -F <package> test <path>` exits 0 (for passing tests) or non-zero (for a deliberately-failing baseline).
- [ ] Source-tag test: if Test.source=`"baseline"`, a matching entry exists in `.atlas/baselines.json` recording the human author + date.
- [ ] This is NOT emitted as a Test node (that would cause infinite recursion); it's a registry-level assertion.

## Anti-patterns

- Do not emit `covers`-edge — Tests test other nodes, not themselves.
