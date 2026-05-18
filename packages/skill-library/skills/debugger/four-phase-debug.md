---
name: four-phase-debug
description: Reproduce → isolate → hypothesize → verify; never guess, always measure
activate_on: "bug-fix"
model_hint: sonnet
---

# Four-Phase Debug

## When to use

The canonical skill for any bug-fix-scope task. Produces the artifact the Agree step expects: a four-phase debug report with identified root cause.

## Checklist

- [ ] **Phase 1 — Reproduce.** Run the code. Observe the bug. Record exact steps + environment. If it cannot be reproduced, the bug is a hypothesis, not a fact.
- [ ] **Phase 2 — Isolate.** Narrow the failure region. Bisect. Remove unrelated variables. Produce a minimal failing case.
- [ ] **Phase 3 — Hypothesize.** State the suspected root cause in one sentence. Predict what would happen if the hypothesis is correct AND wrong.
- [ ] **Phase 4 — Verify.** Run the experiment that discriminates between "hypothesis correct" and "hypothesis wrong." Record the outcome.
- [ ] Only after Phase 4 passes: implement the fix + write a regression test.

## Anti-patterns

- Do not skip Phase 1 because "I know what the bug is." You don't.
- Do not conflate hypotheses. Test one thing at a time.
- Do not ship a fix without a regression test — the bug will recur.
