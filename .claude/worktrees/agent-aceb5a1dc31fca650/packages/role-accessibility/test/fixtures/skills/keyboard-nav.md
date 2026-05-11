---
name: keyboard-nav
description: Test fixture — minimal keyboard-nav skill
activate_on: accessibility
---

# Keyboard Navigation (fixture)

- Verify all interactive elements are reachable via Tab key focus order.
- Flag missing focus indicators as A11Y-KB-001 (WCAG 2.4.7 AA).
- Check that custom widgets implement ARIA keyboard patterns (arrow keys, escape).
- Report critical when keyboard trap prevents navigation away from a component.
