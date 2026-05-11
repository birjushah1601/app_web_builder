---
name: page-load-check
description: Validate that pages load successfully, return 200, and render a meaningful first paint
activate_on: "merge-gate.browser"
model_hint: sonnet
---

# Page Load Check

## When to use

L3 merge gate. Runs on every diff that touches a Page node, a Route node, or any layout/middleware that changes how pages are served.

## Checklist

- [ ] Every changed Page must reach a 2xx response with the documented `renderMode` (ssr/ssg/csr/isr).
- [ ] First Contentful Paint must occur — confirm the page renders something visible, not a blank document.
- [ ] No `<head>` errors that block render (broken script tags, broken stylesheet links).
- [ ] If `renderMode: "ssr"`, the server-rendered HTML must contain the page's primary content (no SSR-as-CSR-shell anti-pattern).
- [ ] Graceful handling of slow data: a Page that depends on a network-fetched Model must render a loading state, not a blank screen, while data loads.

## Anti-patterns

- Do not accept "loads in dev" as evidence — production builds and dev builds diverge meaningfully on page load behavior.
- Do not accept "client-side renders eventually" if the Page is declared SSR — that's a misclassified renderMode and a real bug.

## Severity guidance

- **critical:** Page returns 5xx, blank screen, or render fails entirely.
- **high:** SSR page falls back to CSR with no loading state.
- **medium:** Slow first paint (> 3s on 4G simulation) without progressive rendering.
- **low:** Cosmetic FOUC (flash of unstyled content) on initial paint.

## Issue code prefix

`BROWSER-LOAD-`
