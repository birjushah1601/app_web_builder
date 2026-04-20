---
name: cross-field
description: Fixture skill demonstrating the split-then-superRefine pattern for discriminated unions with cross-field rules
activate_on:
  - cross-field
---

# Cross-Field Refinement Fixture

This skill's inputs schema uses the B.1 split-then-superRefine pattern.
When `mode` is "strict", the `threshold` field must be present and > 0.
When `mode` is "permissive", `threshold` is ignored.
