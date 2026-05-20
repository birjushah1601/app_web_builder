---
name: gen-test-flow
description: Generate end-to-end Playwright tests for a Flow node (sequence of steps)
activate_on: "node:flow"
model_hint: sonnet
---

# Generate Test — Flow

## When to use

Auto-activated when a `Flow` node is added or its steps/failurePaths change.

## Checklist

- [ ] Happy-path test: walk every step in Flow.steps; assert the final state matches Flow.terminalState.
- [ ] Failure-path tests: for each Flow.failurePaths entry, trigger the failure + assert the recovery path runs.
- [ ] Coverage: confirm every step is observed at least once across the test set.
- [ ] Emit as Test node with `covers`-edge → Flow.
