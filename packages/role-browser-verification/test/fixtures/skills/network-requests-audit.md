---
name: network-requests-audit
description: Audit browser network activity for failed requests, slow endpoints, and overly chatty patterns
activate_on: "merge-gate.browser"
model_hint: sonnet
---

# Network Requests Audit

## When to use

L3 merge gate. Runs on every diff that touches an Endpoint, a `fetches` edge, or any data-fetching component.

## Checklist

- [ ] No 4xx/5xx responses on the documented happy-path flow.
- [ ] Critical-path endpoints respond within their declared latency budget (NFR-8 default: P95 < 500ms for read, < 1s for write).
- [ ] No N+1 fetch patterns — a Page that lists items must not issue one request per item; use a single batched endpoint or pagination.
- [ ] All requests use HTTPS in production builds; reject `http://` references unless explicitly localhost.
- [ ] Request payloads do not leak sensitive fields (PII, auth tokens) into URLs (always in body for non-idempotent ops).
- [ ] Responses include appropriate cache headers — static assets cached aggressively, API responses with sensible TTLs.

## Anti-patterns

- Do not accept "we'll add pagination later" if the Page demonstrably issues > 50 requests on initial load.
- Do not accept tokens in query strings — they end up in server logs, referrer headers, and browser history.

## Severity guidance

- **critical:** Required endpoint returns 5xx; auth token leaked in a URL.
- **high:** N+1 pattern on a list-rendering page; HTTP-not-HTTPS in production.
- **medium:** Endpoint exceeds NFR-8 P95 latency budget on critical path.
- **low:** Suboptimal cache headers; missing Vary header on cacheable responses.

## Issue code prefix

`BROWSER-NET-`
