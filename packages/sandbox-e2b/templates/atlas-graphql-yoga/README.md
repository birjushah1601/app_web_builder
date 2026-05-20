# atlas-graphql-yoga E2B template

Bun 1.2+ + GraphQL Yoga 5.x + Pothos 4.x (code-first schema builder) + Drizzle ORM + Zod + `bun:test`.

Used by Atlas's developer role when the architect's `canvasManifest.artifactKind === "backend-graphql"` AND `ATLAS_FF_MULTI_STACK=true`.

## Pre-installed runtime deps

- **graphql** 16.x — GraphQL spec implementation
- **graphql-yoga** 5.x — server (mounted at `/graphql` via `Bun.serve`)
- **@pothos/core** 4.x — code-first SchemaBuilder
- **@pothos/plugin-drizzle** — Drizzle ORM integration (imported but no DB wired in v1)
- **drizzle-orm** 0.36+ — TypeScript-first ORM (use with `drizzle()` against your DB driver)
- **zod** 3.x — input validation (use in resolvers via `validate: { schema: z.object(...) }`)
- **@types/bun** — TypeScript types for Bun globals
- **typescript** 5.6 (strict)

## Out-of-the-box endpoints

- `GET /` — app metadata `{"name":"Atlas Sandbox","version":"0.1.0","graphqlEndpoint":"/graphql"}`
- `GET /health` — `{"status":"ok","stack":"graphql-yoga","atlas":"sandbox-ready"}`
- `POST /graphql` — GraphQL queries + mutations (Yoga handler)
- `GET /graphql` — GraphiQL UI (Yoga's default; gives diego/priya users an instant explorable schema)

## Local smoke test (no E2B credit)

```bash
cd packages/sandbox-e2b/templates/atlas-graphql-yoga
./scripts/smoke-test-local.sh
```

The script builds the Docker image, runs the container on port **3001**, polls `/health`, then issues a `{ hello }` GraphQL query. Both should succeed.

> **Why 3001 (not 3000)?** The `e2bdev/code-interpreter` base image already binds something on :3000, so `Bun.serve` fails fast with `EADDRINUSE` if we try to use 3000. Per-template port mapping lives in `apps/atlas-web/lib/sandbox/template-router.ts`.

## Build + push to E2B

```bash
cd packages/sandbox-e2b/templates/atlas-graphql-yoga
export E2B_API_KEY=e2b_...
./scripts/build-template.sh
# Capture the printed template ID; add it to e2b.toml's template_id; commit.
```

## Wire into atlas-web

When `ATLAS_FF_MULTI_STACK=true` AND the architect classifies the project as `backend-graphql`, the sandbox factory routes provisioning to this template automatically (via `apps/atlas-web/lib/sandbox/template-router.ts`'s `case "backend-graphql"`). Per-project override via `ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-graphql-yoga`.

## Adding a database

v1 ships Drizzle and the Pothos Drizzle plugin installed but no DB connection. To wire one up in your developer diff:

```ts
// src/db.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";  // dev adds this dep
const queryClient = postgres(process.env.DATABASE_URL!);
export const db = drizzle(queryClient, { schema });
```

Then in `src/schema/builder.ts`:

```ts
import DrizzlePlugin from "@pothos/plugin-drizzle";
import { db } from "../db.js";
import * as schema from "../schema-tables.js";

export const builder = new SchemaBuilder<AtlasPothosTypes>({
  plugins: [DrizzlePlugin],
  drizzle: { client: db, schema }
});
```

## Adding a mutation

```ts
// src/schema/users.ts
import { z } from "zod";
import { builder } from "./builder.js";

const CreateUserInput = builder.inputType("CreateUserInput", {
  fields: (t) => ({
    email: t.string({ required: true }),
    name: t.string({ required: true })
  })
});

builder.mutationType({
  fields: (t) => ({
    createUser: t.field({
      type: "Boolean",
      args: { input: t.arg({ type: CreateUserInput, required: true }) },
      resolve: async (_root, args) => {
        z.object({ email: z.string().email(), name: z.string().min(1) }).parse(args.input);
        // ... persist via db.insert(...).values(...).execute()
        return true;
      }
    })
  })
});
```
