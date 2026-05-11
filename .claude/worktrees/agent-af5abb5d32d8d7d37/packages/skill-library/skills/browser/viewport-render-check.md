---
name: viewport-render-check
description: Validate that pages render correctly across mobile, tablet, and desktop viewports
activate_on: "merge-gate.browser"
model_hint: sonnet
---

# Viewport Render Check

## When to use

L3 merge gate. Runs on every diff that touches a Page, Component, or DesignToken affecting layout.

## Checklist

- [ ] Page renders without horizontal scroll on viewports 320px, 375px, 768px, 1024px, 1440px.
- [ ] Interactive elements (buttons, links, form fields) have a tap target ≥ 44×44 CSS pixels on mobile viewports.
- [ ] Text remains readable at every viewport — no overflow that hides content, no font collapse, no zoom-to-read requirement.
- [ ] Images and media scale appropriately; no fixed-width assets cause horizontal scroll.
- [ ] Sticky/fixed elements (headers, footers, modals) do not occlude critical content on small viewports.
- [ ] Forms remain usable on mobile — labels visible, fields accessible, submit button reachable without scrolling away from validation messages.

## Anti-patterns

- Do not accept "looks fine on my laptop" — mobile is the dominant traffic share for most apps.
- Do not accept hidden-on-mobile critical actions (e.g., a checkout button that disappears below 768px).

## Severity guidance

- **critical:** Critical action (sign-in, checkout, primary CTA) is unreachable on mobile viewport.
- **high:** Horizontal scroll is required to see primary content on common mobile viewports.
- **medium:** Tap targets below 44×44 on mobile-primary screens.
- **low:** Cosmetic spacing inconsistencies between viewports.

## Issue code prefix

`BROWSER-VIEW-`
