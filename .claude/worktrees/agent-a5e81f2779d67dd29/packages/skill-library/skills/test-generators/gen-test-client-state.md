---
name: gen-test-client-state
description: Generate state-machine tests for a ClientState node (transitions + invariants)
activate_on: "node:clientstate"
model_hint: sonnet
---

# Generate Test — ClientState

## When to use

Auto-activated when a `ClientState` node is added or its states/transitions change.

## Checklist

- [ ] Initial-state test: the state machine starts in the declared initial state.
- [ ] Transition tests: each declared (from → event → to) transition works.
- [ ] Illegal-transition test: events not in the transition table are rejected.
- [ ] Persistence test: if ClientState.persistence is `"localStorage"` or `"url"`, assert round-trip across reloads.
- [ ] Emit as Test node with `covers`-edge → ClientState.
