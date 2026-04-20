---
name: gen-test-page
description: Generate Playwright + visual-diff + accessibility baseline tests for a Page node
activate_on: "node:page"
model_hint: sonnet
---

# Generate Test — Page

## When to use

Auto-activated when a `Page` node is added or its `path`/`title`/`renderMode`/`authRequired`/`routeRef` changes.

## Checklist

- [ ] Playwright test: navigate to Page.path, assert response 200, assert `<title>` contains Page.title.
- [ ] Axe-core test: run on the rendered Page, assert no WCAG 2.2 AA violations.
- [ ] Visual-diff test: screenshot the Page at 1440×900 + 375×667; compare to baseline.
- [ ] If authRequired=true, also: unauthed visit redirects to the AuthBoundary's sign-in path.
- [ ] Emit as a Test node in the Spec Graph with `source: "baseline"` and `covers`-edge → Page.

## Anti-patterns

- Do not generate tests that depend on specific content strings unless the Page has content fixtures. Test structure + semantics, not copy.
