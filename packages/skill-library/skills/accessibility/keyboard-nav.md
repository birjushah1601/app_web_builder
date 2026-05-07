---
name: keyboard-nav
description: Every interactive element reachable + operable via keyboard; arrow-key roving is a nudge, not a blocker
activate_on: "merge-gate.a11y"
model_hint: sonnet
---

# Keyboard Navigation

## When to use

L5 merge gate. Runs on every Page.

## Severity tiers (CRITICAL)

The auto-fix loop only triggers on `critical`. Tab-key reachability + Enter/Space activation are gating concerns; arrow-key roving is the polish layer.

- **`critical`** — Element is genuinely unreachable or unoperable by keyboard:
  - Click-only `<div>` / `<span>` with no `role="button"` AND no `tabindex="0"` AND no `onKeyDown` for Enter/Space (literally cannot be triggered without a mouse)
  - `outline: none` applied globally with no replacement focus indicator anywhere
  - Modal dialog that does not trap focus AND can be reached without closing the underlying page (focus escapes behind the modal)
  - Form input with no semantic label and no `aria-label` (screen reader cannot identify it AND it's tabbable)
- **`major`** — Reachable + operable but suboptimal:
  - Tab order doesn't follow visual order (negative `tabindex` on a focusable element)
  - Modal traps focus but doesn't restore on close
  - Element has only Enter handler, missing Space (works but uncommon for buttons)
- **`minor`** — Best-practice nudges that DO NOT BLOCK keyboard access:
  - Arrow-key navigation missing on a tablist (Tab still works; ARIA APG recommends arrow-key roving but WCAG doesn't require it)
  - Custom focus indicator could be more visible (current default focus IS visible, just plain)
  - Roving tabindex pattern not implemented for a tab group
  - "Should call e.preventDefault() in keyDown handler" (correctness nuance, not a keyboard reachability issue)

## Checklist

- [ ] Every Component with `onClick` is either (a) a semantic `<button>`/`<a>`, OR (b) has `role="button"` + `tabindex="0"` + `onKeyDown` for Enter/Space. If any of these are missing → `critical`.
- [ ] `outline: none` is paired with a replacement focus indicator (`focus-visible:ring`, `focus:outline`, etc.) somewhere. Missing replacement → `critical`.
- [ ] Tab order matches visual order. Out-of-order → `major`.
- [ ] Modal dialogs trap focus + restore on close. Trap missing → `critical`. Restore missing → `major`.
- [ ] Arrow-key tab navigation, roving tabindex, Home/End shortcuts → `minor` (nudge), unless the user explicitly asked for ARIA APG compliance.

## Anti-patterns

- **Do NOT mark missing arrow-key navigation as `critical` for a tablist.** Tab + Enter is the keyboard contract; arrow keys are polish.
- Do not classify "browser default focus is plain" as critical — it's still visible.
- Do not use `<div onClick>` without keyboard wiring — but flag this as critical only when literally untraceable, not just stylistically suboptimal.
