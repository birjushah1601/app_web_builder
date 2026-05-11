---
name: console-error-check
description: Detect JavaScript errors and unhandled promise rejections that surface in the browser console
activate_on: "merge-gate.browser"
model_hint: sonnet
---

# Console Error Check

## When to use

L3 merge gate. Runs on every diff that touches Components, ClientState, or any client-side code.

## Checklist

- [ ] No unhandled exceptions thrown during page load or initial interaction.
- [ ] No unhandled promise rejections (`Uncaught (in promise)` warnings).
- [ ] No React/Vue/Svelte hydration errors (e.g., "Hydration failed because the initial UI does not match what was rendered on the server").
- [ ] No 404s on resources referenced by the page (images, fonts, scripts, stylesheets).
- [ ] No CORS errors blocking required resources.
- [ ] No deprecated browser API warnings on critical paths (e.g., `document.write`, synchronous XHR).

## Anti-patterns

- Do not silence errors with empty catch blocks or `error.preventDefault()` workarounds — surface and fix the root cause.
- Do not accept "this only happens in dev" — many dev-mode errors indicate real production bugs masked by build optimizations.

## Severity guidance

- **critical:** Page-breaking error — app crashes, white screen, or critical feature unusable.
- **high:** Hydration mismatch, blocking CORS error, or 404 on a critical resource.
- **medium:** Recoverable promise rejection, deprecated API warning on a hot path.
- **low:** Console noise (warnings, deprecation notices) that does not affect functionality.

## Issue code prefix

`BROWSER-CON-`
