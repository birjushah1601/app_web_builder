# Plan D.4 — GraphQL backend cross-stack (5 TDD tasks)

**Spec:** `docs/superpowers/specs/2026-06-02-plan-d4-graphql-cross-stack-design.md`

## Tasks

### Task 1 — Add graphql-codegen + graphql deps

Add to `packages/workflow-engine/package.json`:
- `@graphql-codegen/typescript` ^6.0.2
- `@graphql-codegen/typescript-operations` ^6.0.3
- `graphql` ^16.14.1

`pnpm install --filter @atlas/workflow-engine...` resolves cleanly.

### Task 2 — `generateGraphqlClient` pure helper

New file `packages/workflow-engine/src/graphql-client-gen.ts`:

```ts
export interface GenerateGraphqlClientOptions {
  fileName?: string;        // default: "graphql-client.ts"
  operations?: string;      // optional raw GraphQL document text
}

export async function generateGraphqlClient(
  graphqlSchema: string,
  opts?: GenerateGraphqlClientOptions
): Promise<GeneratedClient>;
```

Implementation: call `@graphql-codegen/core`'s `codegen` with the
`typescript` plugin (always) and the `typescript-operations` plugin (only when
`opts.operations` is non-empty). Concatenate plugin output. Return
`{ path: "lib/" + fileName, contents }`.

Pure — no filesystem access. Throws on invalid SDL.

Unit tests (`test/graphql-client-gen.test.ts`):
- Default path is `lib/graphql-client.ts` when no `fileName`.
- `fileName` override returns `lib/<fileName>`.
- Output contains `export type` (typescript plugin always emits types).
- Invalid SDL throws.
- With `operations` provided, output also contains operation type names.

### Task 3 — `BackendGraphqlArtifact` schema + registration

New file `packages/workflow-engine/src/artifact-contracts/backend-graphql.ts`:

```ts
export const BackendGraphqlArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("backend-graphql"),
  graphqlSchema: z.string().min(1),
  operations: z.string().optional(),
  sandboxId: z.string().min(1),
  previewUrl: z.string().url().optional(),
  envContract: z.array(z.object({
    name: z.string().min(1),
    required: z.boolean(),
    description: z.string().optional()
  }))
});
ArtifactContractRegistry.register("backend-graphql", BackendGraphqlArtifactSchema);
```

Add `import "./backend-graphql.js";` to
`packages/workflow-engine/src/artifact-contracts/index.ts`.

Tests (`test/artifact-contracts/backend-graphql.test.ts`):
- Accepts minimal valid artifact.
- Rejects wrong `kind` literal.
- Rejects non-URL `previewUrl`.
- Accepts optional `operations` + `envContract` entries.
- Is registered against `"backend-graphql"` in the registry.

### Task 4 — Engine cross-stack block extension

In `packages/workflow-engine/src/engine.ts` `makeLaunchRitual`:

- Keep the existing REST scan (D.2/D.3 behavior).
- After it, walk `node.consumes` again and collect every upstream artifact whose
  `kind === "backend-graphql"` and that has a `graphqlSchema` string field.
- For each, call
  `generateGraphqlClient(graphqlSchema, { fileName: \`graphql-client-${id}.ts\`, operations })`
  where `operations` comes from the upstream artifact's `operations` field
  (may be undefined).
- Concatenate the GraphQL files onto `generatedFiles`. If `generatedFiles`
  was `undefined` and only GraphQL exists, initialize it to the GraphQL array.

Tests (`test/engine-launch-ritual-cross-stack-graphql.test.ts`):
- Frontend + 1 GraphQL backend → `generatedFiles.length === 1`, path is
  `lib/graphql-client-<id>.ts`, contents matches `/export\s+type/`.
- Frontend + 1 REST backend + 1 GraphQL backend → `generatedFiles.length === 2`;
  paths sorted are `[lib/api-client.ts, lib/graphql-client-<gqlNodeId>.ts]`.
- Frontend + 0 GraphQL backends, 1 REST backend → identical to D.2 behavior
  (`lib/api-client.ts`, length 1) — backward-compat assertion.

### Task 5 — Typecheck + run all workflow-engine tests

`pnpm --filter @atlas/workflow-engine typecheck` and
`pnpm --filter @atlas/workflow-engine test` both green. All existing D.2/D.3
cross-stack tests still pass unchanged.
