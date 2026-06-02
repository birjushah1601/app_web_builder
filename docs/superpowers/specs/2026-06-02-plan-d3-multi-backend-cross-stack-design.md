# Plan D.3 — Multi-backend cross-stack consumption

**Status:** Approved 2026-06-02
**Parent spec:** `docs/superpowers/specs/2026-05-31-plan-d2-frontend-cross-stack-design.md`
**Predecessor:** Plan D.2 — frontend cross-stack (single-backend)
**Successor (planned):** GraphQL client generation (`backend-graphql`)

---

## Goal

Plan D.2 generates a typed TypeScript API client for a `frontend-app` workflow node
when it consumes a single `backend-rest-api` upstream. If two or more backend upstreams
exist, D.2 throws with the message
`"Plan D.2 v1: multiple backend upstreams not supported (...) Multi-backend cross-stack is Plan D.3."`.

Plan D.3 removes that throw. When N (>=1) `backend-rest-api` upstreams exist for a
single frontend node, the engine generates N api-client files and threads them all
into `priorArtifact.generatedFiles`.

## Architecture decisions (locked)

1. **Naming convention** — When N == 1, preserve the existing canonical
   `lib/api-client.ts` path (backward-compatible with D.2 and the atlas-next-ts
   template's `@/lib/api-client` import). When N >= 2, each file becomes
   `lib/api-client-{backendNodeId}.ts`. The `backendNodeId` is the workflow node id
   of the producing backend node (already DNS-safe by planner convention).
2. **No deduplication / merging** — Each backend gets its own file. The LLM can
   pick which client to import per route. No attempt to merge OpenAPI specs.
3. **Generation still mechanical** — Same `openapi-typescript` library, called once
   per backend upstream. No LLM in the loop.
4. **Order-stable** — Files are emitted in the order they appear in
   `node.consumes` so a given DAG produces a deterministic generatedFiles array
   across runs (helps snapshot tests + LLM cache hits).
5. **GraphQL deferred** — `backend-graphql` upstream kind remains out of scope
   (needs `@graphql-codegen/typescript` instead — own future plan).

## Generated file path table

| N backend upstreams | File path(s)                                           |
|--------------------|--------------------------------------------------------|
| 0                  | `generatedFiles` omitted entirely                       |
| 1                  | `lib/api-client.ts` (unchanged from D.2)                |
| 2+                 | `lib/api-client-{backendNodeId}.ts` per backend         |

## Out of scope (later)

- GraphQL client generation (`backend-graphql`)
- A bundled `createClient()` wrapper (openapi-fetch)
- Cross-backend type deduplication
- A barrel `lib/api-clients/index.ts` re-export
- Verifying the LLM actually USES the generated clients

## Affected files

**Modified:**
- `packages/workflow-engine/src/engine.ts` — replace the multi-backend throw with
  N-file generation; switch to per-backend naming convention when N >= 2.
- `packages/workflow-engine/src/api-client-gen.ts` — accept optional `fileName`
  parameter so the engine can name multi-backend files.
- `packages/workflow-engine/test/engine-launch-ritual-cross-stack.test.ts` —
  replace the existing "throws on 2+" test with two-backend + three-backend cases.
- `packages/workflow-engine/test/api-client-gen.test.ts` — add a test for the
  optional `fileName` parameter.

## Shippable result

A workflow with 1 frontend node + 2 backend nodes (frontend `consumes` both)
launches the frontend ritual with `priorArtifact.generatedFiles` containing
TWO files, each named for its producing backend, each with that backend's
openapi-typescript output. No throw. Single-backend workflows continue to
produce the canonical `lib/api-client.ts`.
