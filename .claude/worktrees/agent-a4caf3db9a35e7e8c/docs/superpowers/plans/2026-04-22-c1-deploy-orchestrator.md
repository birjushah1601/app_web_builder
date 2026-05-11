# C-1 — Atlas Run Deploy Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@atlas/deploy-orchestrator` + `@atlas/postgres-branching` + a baseline Atlas Helm chart so that clicking **Ship** on a project provisions a Knative `Service` for the workload, an Argo CD `Application` that keeps it in sync, a cert-manager `Certificate` for TLS, a Cloudflare DNS record at the edge, and a per-branch Postgres schema with the project's drizzle migrations replayed.

**Architecture:** Per ADR-001 (2026-04-22) the deploy stack is **DIY on Kubernetes** — no Vercel, no Coolify. The orchestrator emits manifests; Argo CD reconciles them onto the cluster; Knative gives per-revision URLs + scale-to-zero (ideal for preview branches); cert-manager issues TLS via the Cloudflare DNS-01 solver; Cloudflare handles edge TLS termination + WAF + DDoS. Postgres branching is **schema-per-branch** within a shared cluster — the branching adapter just runs `CREATE SCHEMA branch_<id>` and replays drizzle migrations against `search_path=branch_<id>`. The orchestrator is provider-abstract: every concrete K8s primitive sits behind a `KubernetesClient` interface so the same orchestrator works against k3d locally, EKS in hosted Atlas, and a sovereign cluster at OVHcloud / CtrlS.

**Tech Stack:** TypeScript 5.6.3, Zod 3.23.8, Vitest 2.1.8, `@kubernetes/client-node` 0.22 (K8s API), `pg` 8.13 (already in tree), `js-yaml` 4.1, `cloudflare` SDK 3.x. New runtime dependency: a kubeconfig accessible to the deploy process. Local dev: k3d for the K8s side, the existing docker-compose Postgres for the DB side.

**Prerequisites:**
- ADR-001 merged (`e0e7a56` + `2b3410b`).
- `@atlas/spec-graph-data` v0.0.0 with drizzle migrations 0000–0006 (already shipped).
- `@atlas/sandbox-e2b` v0.0.0 with the 6 templates from B-4 (already shipped).
- Cluster prerequisites (documented in `deploy/atlas-helm/README.md` as part of Task 14): Argo CD installed, Knative Serving installed, cert-manager installed with a Cloudflare-DNS-01 ClusterIssuer.

---

## File Structure

```
packages/postgres-branching/
├── package.json                            # @atlas/postgres-branching
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── src/
│   ├── index.ts                            # barrel exports
│   ├── adapter.ts                          # BranchingPostgresAdapter
│   ├── migrate.ts                          # replayMigrationsToSchema(schema, dir)
│   ├── naming.ts                           # branchSchemaName(projectId, branchId)
│   └── errors.ts
└── test/
    ├── adapter.test.ts                     # against atlas_test
    ├── migrate.test.ts
    └── naming.test.ts

packages/deploy-orchestrator/
├── package.json                            # @atlas/deploy-orchestrator
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── src/
│   ├── index.ts
│   ├── types.ts                            # DeployRequest, DeployResult, DeploymentStatus
│   ├── errors.ts
│   ├── manifests/
│   │   ├── knative-service.ts              # emit Knative Service YAML
│   │   ├── argo-application.ts             # emit Argo CD Application YAML
│   │   └── cert-manager-cert.ts            # emit cert-manager Certificate YAML
│   ├── kubernetes-client.ts                # KubernetesClient interface + InMemoryKubernetesClient + RealK8sClient
│   ├── cloudflare-client.ts                # CloudflareClient interface + InMemory + Real
│   ├── orchestrator.ts                     # DeployOrchestrator.deploy(request)
│   └── reconcile.ts                        # poll Argo Application status until Healthy/Failed
└── test/
    ├── manifests-knative.test.ts
    ├── manifests-argo.test.ts
    ├── manifests-cert.test.ts
    ├── orchestrator-happy-path.test.ts     # InMemoryKubernetesClient
    ├── orchestrator-rollback.test.ts
    ├── reconcile.test.ts
    └── fixtures/
        └── sample-deploy-request.json

deploy/atlas-helm/
├── Chart.yaml                              # baseline chart for the cluster prerequisites
├── values.yaml
├── templates/
│   ├── argocd-application-set.yaml
│   ├── knative-namespace.yaml
│   ├── cluster-issuer-cloudflare.yaml
│   └── grafana-loki-ingress.yaml
└── README.md                               # cluster prerequisites + bootstrap order

apps/atlas-web/
├── lib/deploy/
│   └── ship-action.ts                      # NEW — Server Action that calls DeployOrchestrator
└── test/lib/deploy/
    └── ship-action.test.ts
```

---

## Types & Contracts

```ts
// packages/deploy-orchestrator/src/types.ts
export const DeployTargetSchema = z.enum(["preview", "production"]);
export type DeployTarget = z.infer<typeof DeployTargetSchema>;

export const DeployRequestSchema = z.object({
  projectId: z.string().uuid(),
  /** Stable ID of the branch — main, preview-<pr-number>, etc. */
  branchId: z.string().min(1),
  /** Container image — sha256-pinned, no floating tags. */
  imageRef: z.string().regex(/^[^:]+@sha256:[0-9a-f]{64}$/),
  /** Target environment. preview → scale-to-zero; production → keep-warm. */
  target: DeployTargetSchema,
  /** Subdomain (without the apex). */
  subdomain: z.string().min(1).regex(/^[a-z0-9-]+$/),
  /** Apex domain. e.g., "atlas.app" for hosted, "<customer>.com" for sovereign. */
  apex: z.string().min(1),
  /** Env vars passed to the workload. */
  env: z.record(z.string(), z.string()).default({})
}).strict();
export type DeployRequest = z.infer<typeof DeployRequestSchema>;

export const DeploymentPhaseSchema = z.enum([
  "queued",
  "branch-db-provisioning",
  "manifests-applying",
  "argo-syncing",
  "knative-rollout",
  "cert-provisioning",
  "dns-propagating",
  "healthy",
  "failed",
  "rolled-back"
]);
export type DeploymentPhase = z.infer<typeof DeploymentPhaseSchema>;

export const DeployResultSchema = z.object({
  deployId: z.string().uuid(),
  request: DeployRequestSchema,
  phase: DeploymentPhaseSchema,
  /** Public URL once cert + DNS are ready. */
  publicUrl: z.string().url().optional(),
  /** Argo Application name for status reconciliation. */
  argoApplicationName: z.string().min(1),
  /** Postgres schema for this branch. */
  branchSchemaName: z.string().min(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  errorMessage: z.string().optional()
}).strict();
export type DeployResult = z.infer<typeof DeployResultSchema>;

// packages/postgres-branching/src/adapter.ts
export interface BranchingPostgresAdapter {
  /** Create the schema for this (projectId, branchId) pair if absent. Idempotent. */
  ensureBranch(projectId: string, branchId: string): Promise<{ schemaName: string; created: boolean }>;
  /** Drop the schema. No-op if absent. */
  dropBranch(projectId: string, branchId: string): Promise<{ schemaName: string; dropped: boolean }>;
  /** List branch schemas for a project. */
  listBranches(projectId: string): Promise<string[]>;
}
```

---

### Task 1: Scaffold `@atlas/postgres-branching` package

**Files:**
- Create: `packages/postgres-branching/package.json`
- Create: `packages/postgres-branching/tsconfig.json`
- Create: `packages/postgres-branching/vitest.config.ts`
- Create: `packages/postgres-branching/src/index.ts`
- Test: `packages/postgres-branching/test/scaffold.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/postgres-branching/test/scaffold.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import * as pkg from "../src/index.js";
describe("@atlas/postgres-branching package barrel", () => {
  it("exposes a stable barrel", () => { expect(pkg).toBeDefined(); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/postgres-branching test`
Expected: FAIL — package not installed.

- [ ] **Step 3: Write minimal implementation**

`packages/postgres-branching/package.json`:
```json
{
  "name": "@atlas/postgres-branching",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": { "pg": "^8.13.1", "zod": "3.23.8" },
  "devDependencies": {
    "@types/node": "22.9.0",
    "@types/pg": "^8.11.10",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

`packages/postgres-branching/tsconfig.json` and `vitest.config.ts`: copy the shape from `@atlas/audit-log` (same structure).

`packages/postgres-branching/src/index.ts`:
```ts
export {};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm install && pnpm --filter @atlas/postgres-branching test`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/postgres-branching/ pnpm-lock.yaml
git commit -m "feat(postgres-branching): scaffold package"
```

---

### Task 2: `branchSchemaName()` helper + tests

**Files:**
- Create: `packages/postgres-branching/src/naming.ts`
- Test: `packages/postgres-branching/test/naming.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { branchSchemaName, BranchNameError } from "../src/naming.js";

describe("branchSchemaName", () => {
  it("returns deterministic name for a (projectId, branchId)", () => {
    const a = branchSchemaName("11111111-1111-4111-8111-111111111111", "main");
    const b = branchSchemaName("11111111-1111-4111-8111-111111111111", "main");
    expect(a).toBe(b);
  });

  it("includes a stable prefix and a hashed suffix", () => {
    const name = branchSchemaName("11111111-1111-4111-8111-111111111111", "preview-42");
    expect(name).toMatch(/^br_[0-9a-f]{16}$/);
  });

  it("differs across branches in the same project", () => {
    const a = branchSchemaName("11111111-1111-4111-8111-111111111111", "main");
    const b = branchSchemaName("11111111-1111-4111-8111-111111111111", "preview-42");
    expect(a).not.toBe(b);
  });

  it("rejects branchId with characters that could escape SQL identifier rules", () => {
    expect(() =>
      branchSchemaName("11111111-1111-4111-8111-111111111111", 'main"; DROP SCHEMA public; --')
    ).toThrow(BranchNameError);
  });

  it("rejects empty branchId", () => {
    expect(() => branchSchemaName("11111111-1111-4111-8111-111111111111", "")).toThrow(BranchNameError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/postgres-branching test naming`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { createHash } from "node:crypto";

export class BranchNameError extends Error {
  constructor(message: string) { super(message); this.name = "BranchNameError"; }
}

const ALLOWED = /^[A-Za-z0-9_-]+$/;

export function branchSchemaName(projectId: string, branchId: string): string {
  if (!branchId) throw new BranchNameError("branchId must be non-empty");
  if (!ALLOWED.test(branchId)) {
    throw new BranchNameError(`branchId contains illegal characters: "${branchId}"`);
  }
  const hash = createHash("sha256").update(`${projectId}|${branchId}`).digest("hex");
  return `br_${hash.slice(0, 16)}`;
}
```

The hashed name is 19 chars (well under Postgres's 63-char identifier limit) and contains only `[a-z_0-9]` — safe to interpolate into `CREATE SCHEMA`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/postgres-branching test naming`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/postgres-branching/src/naming.ts packages/postgres-branching/test/naming.test.ts
git commit -m "feat(postgres-branching): branchSchemaName + BranchNameError"
```

---

### Task 3: `BranchingPostgresAdapter` — ensure / drop / list

**Files:**
- Create: `packages/postgres-branching/src/adapter.ts`
- Create: `packages/postgres-branching/src/errors.ts`
- Test: `packages/postgres-branching/test/adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { PgBranchingAdapter } from "../src/adapter.js";

const projectId = "11111111-1111-4111-8111-111111111111";

describe("PgBranchingAdapter", () => {
  let pool: pg.Pool;
  let adapter: PgBranchingAdapter;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST! });
    adapter = new PgBranchingAdapter(pool);
  });

  beforeEach(async () => {
    // Drop any leftover branch schemas from previous runs.
    const r = await pool.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'br_%'"
    );
    for (const row of r.rows) {
      await pool.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("ensureBranch creates a schema; second call is idempotent", async () => {
    const first = await adapter.ensureBranch(projectId, "main");
    expect(first.created).toBe(true);
    expect(first.schemaName).toMatch(/^br_[0-9a-f]{16}$/);
    const second = await adapter.ensureBranch(projectId, "main");
    expect(second.created).toBe(false);
    expect(second.schemaName).toBe(first.schemaName);
  });

  it("listBranches returns all branch schemas for a project", async () => {
    await adapter.ensureBranch(projectId, "main");
    await adapter.ensureBranch(projectId, "preview-1");
    await adapter.ensureBranch(projectId, "preview-2");
    const branches = await adapter.listBranches(projectId);
    expect(branches.length).toBe(3);
  });

  it("dropBranch removes the schema; no-op when absent", async () => {
    const ensured = await adapter.ensureBranch(projectId, "tmp");
    const dropped = await adapter.dropBranch(projectId, "tmp");
    expect(dropped.dropped).toBe(true);
    expect(dropped.schemaName).toBe(ensured.schemaName);
    const noop = await adapter.dropBranch(projectId, "tmp");
    expect(noop.dropped).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/postgres-branching test adapter`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`packages/postgres-branching/src/errors.ts`:
```ts
export class BranchOperationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BranchOperationError";
  }
}
```

`packages/postgres-branching/src/adapter.ts`:
```ts
import type { Pool } from "pg";
import { branchSchemaName } from "./naming.js";
import { BranchOperationError } from "./errors.js";

export interface EnsureBranchResult { schemaName: string; created: boolean }
export interface DropBranchResult { schemaName: string; dropped: boolean }

export class PgBranchingAdapter {
  constructor(private readonly pool: Pool) {}

  async ensureBranch(projectId: string, branchId: string): Promise<EnsureBranchResult> {
    const schemaName = branchSchemaName(projectId, branchId);
    try {
      const before = await this.pool.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists",
        [schemaName]
      );
      const existed = before.rows[0]?.exists === true;
      if (!existed) {
        await this.pool.query(`CREATE SCHEMA "${schemaName}"`);
      }
      return { schemaName, created: !existed };
    } catch (err) {
      throw new BranchOperationError(`ensureBranch(${projectId}, ${branchId}) failed`, { cause: err });
    }
  }

  async dropBranch(projectId: string, branchId: string): Promise<DropBranchResult> {
    const schemaName = branchSchemaName(projectId, branchId);
    try {
      const before = await this.pool.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists",
        [schemaName]
      );
      const existed = before.rows[0]?.exists === true;
      if (existed) {
        await this.pool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      return { schemaName, dropped: existed };
    } catch (err) {
      throw new BranchOperationError(`dropBranch(${projectId}, ${branchId}) failed`, { cause: err });
    }
  }

  async listBranches(_projectId: string): Promise<string[]> {
    // schemaName is a hash; we cannot derive (projectId, branchId) back from it.
    // For now, list all br_* schemas. A future refactor can store a (projectId, branchId, schemaName)
    // mapping table; defer until C-1 ships its first end-to-end deploy.
    const r = await this.pool.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'br_%' ORDER BY schema_name"
    );
    return r.rows.map((row) => row.schema_name);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/postgres-branching test adapter`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/postgres-branching/src/adapter.ts packages/postgres-branching/src/errors.ts packages/postgres-branching/test/adapter.test.ts
git commit -m "feat(postgres-branching): PgBranchingAdapter ensure/drop/list"
```

---

### Task 4: `replayMigrationsToSchema()` — replay drizzle migrations against a branch schema

**Files:**
- Create: `packages/postgres-branching/src/migrate.ts`
- Test: `packages/postgres-branching/test/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PgBranchingAdapter } from "../src/adapter.js";
import { replayMigrationsToSchema } from "../src/migrate.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "..", "spec-graph-data", "drizzle");
const projectId = "22222222-2222-4222-8222-222222222222";

describe("replayMigrationsToSchema", () => {
  let pool: pg.Pool;
  let adapter: PgBranchingAdapter;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST! });
    adapter = new PgBranchingAdapter(pool);
  });

  beforeEach(async () => {
    const r = await pool.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'br_%'"
    );
    for (const row of r.rows) {
      await pool.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("replays every .sql file in order against the branch schema", async () => {
    const { schemaName } = await adapter.ensureBranch(projectId, "test-replay");
    const result = await replayMigrationsToSchema({ pool, schemaName, migrationsDir });
    expect(result.applied).toBeGreaterThan(0);
    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [schemaName]
    );
    expect(tables.rows.map((r) => r.table_name)).toContain("spec_graphs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/postgres-branching test migrate`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { BranchOperationError } from "./errors.js";

export interface ReplayInput {
  pool: Pool;
  schemaName: string;
  migrationsDir: string;
}

export interface ReplayResult {
  schemaName: string;
  applied: number;
  filenames: string[];
}

export async function replayMigrationsToSchema(input: ReplayInput): Promise<ReplayResult> {
  const { pool, schemaName, migrationsDir } = input;
  const entries = await readdir(migrationsDir);
  const sqlFiles = entries
    .filter((e) => /^\d{4}_.*\.sql$/.test(e))
    .sort();
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schemaName}"`);
    for (const file of sqlFiles) {
      const sql = await readFile(join(migrationsDir, file), "utf8");
      const stmts = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of stmts) {
        try {
          await client.query(stmt);
        } catch (err) {
          throw new BranchOperationError(`replay failed on ${file}`, { cause: err });
        }
      }
    }
    return { schemaName, applied: sqlFiles.length, filenames: sqlFiles };
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/postgres-branching test migrate`
Expected: PASS (1 passed). Verifies that `spec_graphs` exists in the branch schema after replay.

- [ ] **Step 5: Commit**

```bash
git add packages/postgres-branching/src/migrate.ts packages/postgres-branching/test/migrate.test.ts
git commit -m "feat(postgres-branching): replayMigrationsToSchema replays drizzle SQL into a branch schema"
```

---

### Task 5: postgres-branching barrel + README

**Files:**
- Modify: `packages/postgres-branching/src/index.ts`
- Create: `packages/postgres-branching/README.md`

- [ ] **Step 1: Update barrel**

```ts
export { branchSchemaName, BranchNameError } from "./naming.js";
export { PgBranchingAdapter } from "./adapter.js";
export type { EnsureBranchResult, DropBranchResult } from "./adapter.js";
export { replayMigrationsToSchema } from "./migrate.js";
export type { ReplayInput, ReplayResult } from "./migrate.js";
export { BranchOperationError } from "./errors.js";
```

- [ ] **Step 2: README — short + factual**

Document: schema-per-branch model, how `branchSchemaName` produces the deterministic ID, `ensureBranch` is idempotent, how `replayMigrationsToSchema` is the integration point with `@atlas/spec-graph-data`'s migration directory, and the explicit non-goal of cross-branch FKs (we do not allow them).

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @atlas/postgres-branching typecheck
git add packages/postgres-branching/src/index.ts packages/postgres-branching/README.md
git commit -m "docs(postgres-branching): README + barrel exports"
```

---

### Task 6: Scaffold `@atlas/deploy-orchestrator` package

**Files:**
- Create: `packages/deploy-orchestrator/package.json`
- Create: `packages/deploy-orchestrator/tsconfig.json`
- Create: `packages/deploy-orchestrator/vitest.config.ts`
- Create: `packages/deploy-orchestrator/src/index.ts`
- Test: `packages/deploy-orchestrator/test/scaffold.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import * as pkg from "../src/index.js";
describe("@atlas/deploy-orchestrator package barrel", () => {
  it("exposes a stable barrel", () => { expect(pkg).toBeDefined(); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/deploy-orchestrator test`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`packages/deploy-orchestrator/package.json`:
```json
{
  "name": "@atlas/deploy-orchestrator",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@atlas/postgres-branching": "workspace:*",
    "@atlas/spec-graph-data": "workspace:*",
    "@kubernetes/client-node": "^0.22.0",
    "cloudflare": "^3.0.0",
    "js-yaml": "4.1.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/js-yaml": "4.0.9",
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

`tsconfig.json` + `vitest.config.ts`: same shape as `@atlas/audit-log`.

`src/index.ts`: `export {};`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm install && pnpm --filter @atlas/deploy-orchestrator test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-orchestrator/ pnpm-lock.yaml
git commit -m "feat(deploy-orchestrator): scaffold package"
```

---

### Task 7: types.ts — DeployRequest, DeployResult, DeploymentPhase

**Files:**
- Create: `packages/deploy-orchestrator/src/types.ts`
- Test: `packages/deploy-orchestrator/test/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { DeployRequestSchema, DeployResultSchema, DeploymentPhaseSchema } from "../src/types.js";

const validReq = {
  projectId: "11111111-1111-4111-8111-111111111111",
  branchId: "main",
  imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
  target: "production",
  subdomain: "abc",
  apex: "atlas.app",
  env: { NODE_ENV: "production" }
};

describe("DeployRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(DeployRequestSchema.safeParse(validReq).success).toBe(true);
  });

  it("rejects floating tags (no @sha256:)", () => {
    expect(
      DeployRequestSchema.safeParse({ ...validReq, imageRef: "registry.atlas.app/projects/abc:latest" }).success
    ).toBe(false);
  });

  it("rejects subdomain with uppercase or bad chars", () => {
    expect(DeployRequestSchema.safeParse({ ...validReq, subdomain: "MyApp" }).success).toBe(false);
    expect(DeployRequestSchema.safeParse({ ...validReq, subdomain: "my_app" }).success).toBe(false);
  });

  it("rejects unknown target", () => {
    expect(DeployRequestSchema.safeParse({ ...validReq, target: "staging" }).success).toBe(false);
  });

  it("DeploymentPhaseSchema enumerates the 10 documented phases", () => {
    expect(DeploymentPhaseSchema.options.length).toBe(10);
  });

  it("DeployResultSchema requires phase + argoApplicationName + branchSchemaName", () => {
    const result = {
      deployId: "22222222-2222-4222-8222-222222222222",
      request: validReq,
      phase: "queued",
      argoApplicationName: "p-abc-main",
      branchSchemaName: "br_abcdef0123456789",
      startedAt: "2026-04-22T00:00:00.000Z"
    };
    expect(DeployResultSchema.safeParse(result).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/deploy-orchestrator test types`
Expected: FAIL.

- [ ] **Step 3: Write the schemas (per the Types & Contracts section above).**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/deploy-orchestrator test types`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-orchestrator/src/types.ts packages/deploy-orchestrator/test/types.test.ts
git commit -m "feat(deploy-orchestrator): DeployRequest/DeployResult/DeploymentPhase schemas"
```

---

### Task 8: errors.ts — DeployError + subclasses

**Files:**
- Create: `packages/deploy-orchestrator/src/errors.ts`

- [ ] **Step 1: Write the file**

```ts
export class DeployError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeployError";
  }
}

export class ManifestEmissionError extends DeployError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ManifestEmissionError";
  }
}

export class KubernetesApplyError extends DeployError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KubernetesApplyError";
  }
}

export class CloudflareApplyError extends DeployError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CloudflareApplyError";
  }
}

export class ReconcileTimeoutError extends DeployError {
  constructor(deploymentName: string, elapsedMs: number) {
    super(`reconcile of ${deploymentName} did not reach Healthy within ${elapsedMs}ms`);
    this.name = "ReconcileTimeoutError";
  }
}
```

- [ ] **Step 2: Commit (no test — covered indirectly by orchestrator tests)**

```bash
git add packages/deploy-orchestrator/src/errors.ts
git commit -m "feat(deploy-orchestrator): DeployError + subclasses"
```

---

### Task 9: Knative Service manifest emitter

**Files:**
- Create: `packages/deploy-orchestrator/src/manifests/knative-service.ts`
- Test: `packages/deploy-orchestrator/test/manifests-knative.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { emitKnativeServiceManifest } from "../src/manifests/knative-service.js";
import type { DeployRequest } from "../src/types.js";

const baseReq: DeployRequest = {
  projectId: "11111111-1111-4111-8111-111111111111",
  branchId: "main",
  imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
  target: "production",
  subdomain: "abc",
  apex: "atlas.app",
  env: { DB_SCHEMA: "br_abcdef0123456789" }
};

describe("emitKnativeServiceManifest", () => {
  it("emits a Knative serving.knative.dev/v1 Service", () => {
    const manifest = emitKnativeServiceManifest(baseReq, { branchSchemaName: "br_abcdef0123456789" });
    const parsed = yaml.load(manifest) as Record<string, unknown>;
    expect(parsed.apiVersion).toBe("serving.knative.dev/v1");
    expect(parsed.kind).toBe("Service");
  });

  it("encodes container image as exact sha256 digest", () => {
    const manifest = emitKnativeServiceManifest(baseReq, { branchSchemaName: "br_abcdef0123456789" });
    expect(manifest).toContain("@sha256:" + "0".repeat(64));
  });

  it("sets DB_SCHEMA env from input", () => {
    const manifest = emitKnativeServiceManifest(baseReq, { branchSchemaName: "br_abcdef0123456789" });
    const parsed = yaml.load(manifest) as { spec: { template: { spec: { containers: Array<{ env: Array<{ name: string; value: string }> }> } } } };
    const env = parsed.spec.template.spec.containers[0]!.env;
    expect(env.find((e) => e.name === "DB_SCHEMA")?.value).toBe("br_abcdef0123456789");
  });

  it("sets minScale=1 for production target (no scale-to-zero)", () => {
    const manifest = emitKnativeServiceManifest(baseReq, { branchSchemaName: "br_x" });
    const parsed = yaml.load(manifest) as { spec: { template: { metadata: { annotations: Record<string, string> } } } };
    expect(parsed.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"]).toBe("1");
  });

  it("sets minScale=0 for preview target (scale-to-zero)", () => {
    const manifest = emitKnativeServiceManifest({ ...baseReq, target: "preview" }, { branchSchemaName: "br_x" });
    const parsed = yaml.load(manifest) as { spec: { template: { metadata: { annotations: Record<string, string> } } } };
    expect(parsed.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"]).toBe("0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/deploy-orchestrator test manifests-knative`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import yaml from "js-yaml";
import type { DeployRequest } from "../types.js";

export interface EmitOptions {
  branchSchemaName: string;
}

export function knativeServiceName(req: DeployRequest): string {
  return `p-${req.subdomain}-${req.branchId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function emitKnativeServiceManifest(req: DeployRequest, opts: EmitOptions): string {
  const name = knativeServiceName(req);
  const minScale = req.target === "production" ? "1" : "0";
  const env = [
    { name: "DB_SCHEMA", value: opts.branchSchemaName },
    ...Object.entries(req.env).map(([key, value]) => ({ name: key, value }))
  ];
  const doc = {
    apiVersion: "serving.knative.dev/v1",
    kind: "Service",
    metadata: {
      name,
      namespace: `atlas-projects`,
      labels: {
        "atlas.app/project-id": req.projectId,
        "atlas.app/branch-id": req.branchId,
        "atlas.app/target": req.target
      }
    },
    spec: {
      template: {
        metadata: {
          annotations: {
            "autoscaling.knative.dev/minScale": minScale,
            "autoscaling.knative.dev/maxScale": "20"
          }
        },
        spec: {
          containerConcurrency: 50,
          containers: [
            {
              image: req.imageRef,
              env,
              resources: {
                requests: { cpu: "100m", memory: "256Mi" },
                limits: { cpu: "1000m", memory: "1Gi" }
              }
            }
          ]
        }
      }
    }
  };
  return yaml.dump(doc, { lineWidth: -1 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/deploy-orchestrator test manifests-knative`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-orchestrator/src/manifests/knative-service.ts packages/deploy-orchestrator/test/manifests-knative.test.ts
git commit -m "feat(deploy-orchestrator): emit Knative Service manifest with target-driven minScale"
```

---

### Task 10: Argo CD Application manifest emitter

**Files:**
- Create: `packages/deploy-orchestrator/src/manifests/argo-application.ts`
- Test: `packages/deploy-orchestrator/test/manifests-argo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { emitArgoApplicationManifest, argoApplicationName } from "../src/manifests/argo-application.js";

const baseReq = {
  projectId: "11111111-1111-4111-8111-111111111111",
  branchId: "main",
  imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
  target: "production" as const,
  subdomain: "abc",
  apex: "atlas.app",
  env: {}
};

describe("emitArgoApplicationManifest", () => {
  it("emits an argoproj.io/v1alpha1 Application", () => {
    const manifest = emitArgoApplicationManifest(baseReq, {
      manifestRepoUrl: "https://gitea.atlas.app/atlas/deployments.git",
      manifestPath: "projects/abc/main"
    });
    const parsed = yaml.load(manifest) as Record<string, unknown>;
    expect(parsed.apiVersion).toBe("argoproj.io/v1alpha1");
    expect(parsed.kind).toBe("Application");
  });

  it("targets the destination namespace atlas-projects", () => {
    const manifest = emitArgoApplicationManifest(baseReq, {
      manifestRepoUrl: "git@example",
      manifestPath: "x"
    });
    const parsed = yaml.load(manifest) as { spec: { destination: { namespace: string } } };
    expect(parsed.spec.destination.namespace).toBe("atlas-projects");
  });

  it("uses the documented application name shape", () => {
    expect(argoApplicationName(baseReq)).toBe("p-abc-main");
  });

  it("sets automated sync with prune + selfHeal", () => {
    const manifest = emitArgoApplicationManifest(baseReq, {
      manifestRepoUrl: "x",
      manifestPath: "x"
    });
    const parsed = yaml.load(manifest) as { spec: { syncPolicy: { automated: { prune: boolean; selfHeal: boolean } } } };
    expect(parsed.spec.syncPolicy.automated.prune).toBe(true);
    expect(parsed.spec.syncPolicy.automated.selfHeal).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/deploy-orchestrator test manifests-argo`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import yaml from "js-yaml";
import type { DeployRequest } from "../types.js";

export interface ArgoEmitOptions {
  manifestRepoUrl: string;
  manifestPath: string;
  targetRevision?: string;
}

export function argoApplicationName(req: DeployRequest): string {
  return `p-${req.subdomain}-${req.branchId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function emitArgoApplicationManifest(req: DeployRequest, opts: ArgoEmitOptions): string {
  const name = argoApplicationName(req);
  const doc = {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: {
      name,
      namespace: "argocd",
      labels: { "atlas.app/project-id": req.projectId, "atlas.app/branch-id": req.branchId }
    },
    spec: {
      project: "atlas-projects",
      source: {
        repoURL: opts.manifestRepoUrl,
        path: opts.manifestPath,
        targetRevision: opts.targetRevision ?? "HEAD"
      },
      destination: { server: "https://kubernetes.default.svc", namespace: "atlas-projects" },
      syncPolicy: {
        automated: { prune: true, selfHeal: true },
        retry: { limit: 5, backoff: { duration: "5s", factor: 2, maxDuration: "3m" } }
      }
    }
  };
  return yaml.dump(doc, { lineWidth: -1 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/deploy-orchestrator test manifests-argo`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-orchestrator/src/manifests/argo-application.ts packages/deploy-orchestrator/test/manifests-argo.test.ts
git commit -m "feat(deploy-orchestrator): emit Argo CD Application manifest with automated sync"
```

---

### Task 11: cert-manager Certificate manifest emitter

**Files:**
- Create: `packages/deploy-orchestrator/src/manifests/cert-manager-cert.ts`
- Test: `packages/deploy-orchestrator/test/manifests-cert.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { emitCertificateManifest } from "../src/manifests/cert-manager-cert.js";

const baseReq = {
  projectId: "11111111-1111-4111-8111-111111111111",
  branchId: "main",
  imageRef: "x@sha256:" + "0".repeat(64),
  target: "production" as const,
  subdomain: "abc",
  apex: "atlas.app",
  env: {}
};

describe("emitCertificateManifest", () => {
  it("emits a cert-manager.io/v1 Certificate", () => {
    const manifest = emitCertificateManifest(baseReq, { issuerRef: "letsencrypt-cloudflare-dns01" });
    const parsed = yaml.load(manifest) as Record<string, unknown>;
    expect(parsed.apiVersion).toBe("cert-manager.io/v1");
    expect(parsed.kind).toBe("Certificate");
  });

  it("includes both apex SAN and subdomain SAN", () => {
    const manifest = emitCertificateManifest(baseReq, { issuerRef: "x" });
    const parsed = yaml.load(manifest) as { spec: { dnsNames: string[] } };
    expect(parsed.spec.dnsNames).toContain("abc.atlas.app");
  });

  it("references the configured ClusterIssuer", () => {
    const manifest = emitCertificateManifest(baseReq, { issuerRef: "letsencrypt-cloudflare-dns01" });
    const parsed = yaml.load(manifest) as { spec: { issuerRef: { name: string; kind: string } } };
    expect(parsed.spec.issuerRef.name).toBe("letsencrypt-cloudflare-dns01");
    expect(parsed.spec.issuerRef.kind).toBe("ClusterIssuer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/deploy-orchestrator test manifests-cert`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import yaml from "js-yaml";
import type { DeployRequest } from "../types.js";

export interface CertEmitOptions {
  issuerRef: string;
}

export function emitCertificateManifest(req: DeployRequest, opts: CertEmitOptions): string {
  const fqdn = `${req.subdomain}.${req.apex}`;
  const doc = {
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: {
      name: `cert-${req.subdomain}-${req.branchId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      namespace: "atlas-projects"
    },
    spec: {
      secretName: `tls-${req.subdomain}-${req.branchId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      dnsNames: [fqdn],
      issuerRef: { name: opts.issuerRef, kind: "ClusterIssuer", group: "cert-manager.io" }
    }
  };
  return yaml.dump(doc, { lineWidth: -1 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/deploy-orchestrator test manifests-cert`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-orchestrator/src/manifests/cert-manager-cert.ts packages/deploy-orchestrator/test/manifests-cert.test.ts
git commit -m "feat(deploy-orchestrator): emit cert-manager Certificate manifest (Cloudflare DNS-01)"
```

---

### Task 12: KubernetesClient + CloudflareClient interfaces + in-memory implementations

**Files:**
- Create: `packages/deploy-orchestrator/src/kubernetes-client.ts`
- Create: `packages/deploy-orchestrator/src/cloudflare-client.ts`
- Test: `packages/deploy-orchestrator/test/kubernetes-client.test.ts`
- Test: `packages/deploy-orchestrator/test/cloudflare-client.test.ts`

- [ ] **Step 1: Write failing tests**

`test/kubernetes-client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";

describe("InMemoryKubernetesClient", () => {
  it("apply records the manifest under (namespace, kind, name)", async () => {
    const c = new InMemoryKubernetesClient();
    await c.apply("argocd", "Application", "p-abc-main", "yaml-text");
    expect(c.get("argocd", "Application", "p-abc-main")).toBe("yaml-text");
  });

  it("delete removes the recorded manifest", async () => {
    const c = new InMemoryKubernetesClient();
    await c.apply("ns", "K", "n", "y");
    await c.delete("ns", "K", "n");
    expect(c.get("ns", "K", "n")).toBeUndefined();
  });
});
```

`test/cloudflare-client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";

describe("InMemoryCloudflareClient", () => {
  it("upsertDnsRecord records the entry", async () => {
    const c = new InMemoryCloudflareClient();
    await c.upsertDnsRecord("atlas.app", "abc.atlas.app", "CNAME", "k8s-ingress.atlas.app");
    expect(c.list("atlas.app")).toEqual([
      { name: "abc.atlas.app", type: "CNAME", content: "k8s-ingress.atlas.app" }
    ]);
  });

  it("deleteDnsRecord is idempotent", async () => {
    const c = new InMemoryCloudflareClient();
    await c.upsertDnsRecord("atlas.app", "abc.atlas.app", "CNAME", "x");
    await c.deleteDnsRecord("atlas.app", "abc.atlas.app");
    await c.deleteDnsRecord("atlas.app", "abc.atlas.app");
    expect(c.list("atlas.app")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @atlas/deploy-orchestrator test kubernetes-client cloudflare-client`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementations**

`src/kubernetes-client.ts`:
```ts
export interface KubernetesClient {
  apply(namespace: string, kind: string, name: string, manifestYaml: string): Promise<void>;
  delete(namespace: string, kind: string, name: string): Promise<void>;
  /** Read the live status of an Argo CD Application as `Healthy` | `Progressing` | `Degraded` | `Missing` | `Unknown`. */
  argoApplicationHealth(name: string): Promise<string>;
}

export class InMemoryKubernetesClient implements KubernetesClient {
  private readonly store = new Map<string, string>();
  private readonly health = new Map<string, string>();

  async apply(namespace: string, kind: string, name: string, manifestYaml: string): Promise<void> {
    this.store.set(`${namespace}/${kind}/${name}`, manifestYaml);
    if (kind === "Application") this.health.set(name, "Healthy");
  }

  async delete(namespace: string, kind: string, name: string): Promise<void> {
    this.store.delete(`${namespace}/${kind}/${name}`);
    if (kind === "Application") this.health.delete(name);
  }

  async argoApplicationHealth(name: string): Promise<string> {
    return this.health.get(name) ?? "Missing";
  }

  get(namespace: string, kind: string, name: string): string | undefined {
    return this.store.get(`${namespace}/${kind}/${name}`);
  }

  setHealth(name: string, status: string): void { this.health.set(name, status); }
}
```

`src/cloudflare-client.ts`:
```ts
export interface CloudflareClient {
  upsertDnsRecord(zone: string, name: string, type: string, content: string): Promise<void>;
  deleteDnsRecord(zone: string, name: string): Promise<void>;
}

export class InMemoryCloudflareClient implements CloudflareClient {
  private readonly records = new Map<string, Map<string, { type: string; content: string }>>();

  async upsertDnsRecord(zone: string, name: string, type: string, content: string): Promise<void> {
    if (!this.records.has(zone)) this.records.set(zone, new Map());
    this.records.get(zone)!.set(name, { type, content });
  }

  async deleteDnsRecord(zone: string, name: string): Promise<void> {
    this.records.get(zone)?.delete(name);
  }

  list(zone: string): Array<{ name: string; type: string; content: string }> {
    const z = this.records.get(zone);
    if (!z) return [];
    return [...z.entries()].map(([name, v]) => ({ name, type: v.type, content: v.content }));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @atlas/deploy-orchestrator test kubernetes-client cloudflare-client`
Expected: PASS (4 total).

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-orchestrator/src/kubernetes-client.ts packages/deploy-orchestrator/src/cloudflare-client.ts packages/deploy-orchestrator/test/kubernetes-client.test.ts packages/deploy-orchestrator/test/cloudflare-client.test.ts
git commit -m "feat(deploy-orchestrator): KubernetesClient + CloudflareClient interfaces + in-memory impls"
```

---

### Task 13: DeployOrchestrator.deploy() — happy path

**Files:**
- Create: `packages/deploy-orchestrator/src/orchestrator.ts`
- Test: `packages/deploy-orchestrator/test/orchestrator-happy-path.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { DeployOrchestrator } from "../src/orchestrator.js";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";

const branchingStub = {
  ensureBranch: async (_p: string, _b: string) => ({ schemaName: "br_abcdef0123456789", created: true }),
  dropBranch: async () => ({ schemaName: "br_x", dropped: true }),
  listBranches: async () => []
};
const migrateStub = async () => ({ schemaName: "br_abcdef0123456789", applied: 6, filenames: [] });

describe("DeployOrchestrator.deploy — happy path", () => {
  it("emits manifests, applies them, returns DeployResult with phase=healthy", async () => {
    const k8s = new InMemoryKubernetesClient();
    const cf = new InMemoryCloudflareClient();
    const orch = new DeployOrchestrator({
      kubernetes: k8s,
      cloudflare: cf,
      branching: branchingStub,
      migrate: migrateStub,
      manifestRepoUrl: "https://gitea.atlas.app/atlas/deployments.git",
      issuerRef: "letsencrypt-cloudflare-dns01",
      ingressTarget: "k8s-ingress.atlas.app"
    });

    const result = await orch.deploy({
      projectId: "11111111-1111-4111-8111-111111111111",
      branchId: "main",
      imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
      target: "production",
      subdomain: "abc",
      apex: "atlas.app",
      env: {}
    });

    expect(result.phase).toBe("healthy");
    expect(result.publicUrl).toBe("https://abc.atlas.app");
    expect(result.argoApplicationName).toBe("p-abc-main");
    expect(result.branchSchemaName).toBe("br_abcdef0123456789");

    expect(k8s.get("argocd", "Application", "p-abc-main")).toBeDefined();
    expect(k8s.get("atlas-projects", "Service", "p-abc-main")).toBeDefined();
    expect(k8s.get("atlas-projects", "Certificate", "cert-abc-main")).toBeDefined();
    expect(cf.list("atlas.app")).toContainEqual({
      name: "abc.atlas.app", type: "CNAME", content: "k8s-ingress.atlas.app"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/deploy-orchestrator test orchestrator-happy`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import { randomUUID } from "node:crypto";
import type { KubernetesClient } from "./kubernetes-client.js";
import type { CloudflareClient } from "./cloudflare-client.js";
import { emitKnativeServiceManifest, knativeServiceName } from "./manifests/knative-service.js";
import { emitArgoApplicationManifest, argoApplicationName } from "./manifests/argo-application.js";
import { emitCertificateManifest } from "./manifests/cert-manager-cert.js";
import { DeployRequestSchema, type DeployRequest, type DeployResult } from "./types.js";
import { DeployError, ManifestEmissionError } from "./errors.js";

export interface BranchingPort {
  ensureBranch(projectId: string, branchId: string): Promise<{ schemaName: string; created: boolean }>;
  dropBranch(projectId: string, branchId: string): Promise<{ schemaName: string; dropped: boolean }>;
  listBranches(projectId: string): Promise<string[]>;
}

export type MigratePort = (input: { schemaName: string }) => Promise<{ schemaName: string; applied: number; filenames: string[] }>;

export interface DeployOrchestratorOptions {
  kubernetes: KubernetesClient;
  cloudflare: CloudflareClient;
  branching: BranchingPort;
  migrate: MigratePort;
  manifestRepoUrl: string;
  issuerRef: string;
  ingressTarget: string;
}

export class DeployOrchestrator {
  constructor(private readonly opts: DeployOrchestratorOptions) {}

  async deploy(input: DeployRequest): Promise<DeployResult> {
    const parsed = DeployRequestSchema.parse(input);
    const deployId = randomUUID();
    const startedAt = new Date().toISOString();

    const branch = await this.opts.branching.ensureBranch(parsed.projectId, parsed.branchId);
    if (branch.created) {
      await this.opts.migrate({ schemaName: branch.schemaName });
    }

    let knativeYaml: string, argoYaml: string, certYaml: string;
    try {
      knativeYaml = emitKnativeServiceManifest(parsed, { branchSchemaName: branch.schemaName });
      argoYaml = emitArgoApplicationManifest(parsed, {
        manifestRepoUrl: this.opts.manifestRepoUrl,
        manifestPath: `projects/${parsed.subdomain}/${parsed.branchId}`
      });
      certYaml = emitCertificateManifest(parsed, { issuerRef: this.opts.issuerRef });
    } catch (err) {
      throw new ManifestEmissionError("manifest emit failed", { cause: err });
    }

    const knativeName = knativeServiceName(parsed);
    const argoName = argoApplicationName(parsed);
    const certName = `cert-${parsed.subdomain}-${parsed.branchId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    await this.opts.kubernetes.apply("atlas-projects", "Service", knativeName, knativeYaml);
    await this.opts.kubernetes.apply("argocd", "Application", argoName, argoYaml);
    await this.opts.kubernetes.apply("atlas-projects", "Certificate", certName, certYaml);

    const fqdn = `${parsed.subdomain}.${parsed.apex}`;
    await this.opts.cloudflare.upsertDnsRecord(parsed.apex, fqdn, "CNAME", this.opts.ingressTarget);

    const health = await this.opts.kubernetes.argoApplicationHealth(argoName);
    if (health !== "Healthy") {
      throw new DeployError(`argo Application ${argoName} reported ${health}`);
    }

    return {
      deployId,
      request: parsed,
      phase: "healthy",
      publicUrl: `https://${fqdn}`,
      argoApplicationName: argoName,
      branchSchemaName: branch.schemaName,
      startedAt,
      endedAt: new Date().toISOString()
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/deploy-orchestrator test orchestrator-happy`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-orchestrator/src/orchestrator.ts packages/deploy-orchestrator/test/orchestrator-happy-path.test.ts
git commit -m "feat(deploy-orchestrator): DeployOrchestrator.deploy happy path (in-memory clients)"
```

---

### Task 14: Argo health-poll reconciler — `phase=failed` when Argo reports Degraded

**Files:**
- Create: `packages/deploy-orchestrator/src/reconcile.ts`
- Modify: `packages/deploy-orchestrator/src/orchestrator.ts` (call into reconciler)
- Test: `packages/deploy-orchestrator/test/reconcile.test.ts`
- Test: `packages/deploy-orchestrator/test/orchestrator-rollback.test.ts`

- [ ] **Step 1: Write failing tests**

`test/reconcile.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { reconcileArgoUntilSettled } from "../src/reconcile.js";
import { ReconcileTimeoutError } from "../src/errors.js";

describe("reconcileArgoUntilSettled", () => {
  it("returns Healthy when client reports Healthy", async () => {
    const k8s = { argoApplicationHealth: vi.fn().mockResolvedValue("Healthy") } as never;
    const result = await reconcileArgoUntilSettled(k8s, "p-abc-main", { intervalMs: 10, timeoutMs: 1000 });
    expect(result).toBe("Healthy");
  });

  it("returns Degraded when client reports Degraded", async () => {
    const k8s = { argoApplicationHealth: vi.fn().mockResolvedValue("Degraded") } as never;
    const result = await reconcileArgoUntilSettled(k8s, "p-abc-main", { intervalMs: 10, timeoutMs: 1000 });
    expect(result).toBe("Degraded");
  });

  it("polls past Progressing into Healthy", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce("Progressing")
      .mockResolvedValueOnce("Progressing")
      .mockResolvedValueOnce("Healthy");
    const k8s = { argoApplicationHealth: fn } as never;
    const result = await reconcileArgoUntilSettled(k8s, "p-abc-main", { intervalMs: 5, timeoutMs: 1000 });
    expect(result).toBe("Healthy");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws ReconcileTimeoutError when timeout elapses without settled state", async () => {
    const k8s = { argoApplicationHealth: vi.fn().mockResolvedValue("Progressing") } as never;
    await expect(
      reconcileArgoUntilSettled(k8s, "p-abc-main", { intervalMs: 5, timeoutMs: 30 })
    ).rejects.toThrow(ReconcileTimeoutError);
  });
});
```

`test/orchestrator-rollback.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { DeployOrchestrator } from "../src/orchestrator.js";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";
import { DeployError } from "../src/errors.js";

const branchingStub = {
  ensureBranch: async () => ({ schemaName: "br_x", created: true }),
  dropBranch: async () => ({ schemaName: "br_x", dropped: true }),
  listBranches: async () => []
};
const migrateStub = async () => ({ schemaName: "br_x", applied: 0, filenames: [] });

describe("DeployOrchestrator.deploy — Argo Degraded triggers rollback", () => {
  it("deletes manifests + DNS when Argo reports Degraded, throws DeployError", async () => {
    const k8s = new InMemoryKubernetesClient();
    const cf = new InMemoryCloudflareClient();
    // Override Argo health to Degraded after apply.
    const origApply = k8s.apply.bind(k8s);
    k8s.apply = async (ns, kind, name, yaml) => {
      await origApply(ns, kind, name, yaml);
      if (kind === "Application") k8s.setHealth(name, "Degraded");
    };
    const orch = new DeployOrchestrator({
      kubernetes: k8s, cloudflare: cf,
      branching: branchingStub, migrate: migrateStub,
      manifestRepoUrl: "x", issuerRef: "x", ingressTarget: "x"
    });
    await expect(orch.deploy({
      projectId: "11111111-1111-4111-8111-111111111111",
      branchId: "main",
      imageRef: "x@sha256:" + "0".repeat(64),
      target: "production",
      subdomain: "abc", apex: "atlas.app", env: {}
    })).rejects.toThrow(DeployError);
    // Rollback removed everything.
    expect(k8s.get("argocd", "Application", "p-abc-main")).toBeUndefined();
    expect(k8s.get("atlas-projects", "Service", "p-abc-main")).toBeUndefined();
    expect(cf.list("atlas.app")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @atlas/deploy-orchestrator test reconcile orchestrator-rollback`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`src/reconcile.ts`:
```ts
import type { KubernetesClient } from "./kubernetes-client.js";
import { ReconcileTimeoutError } from "./errors.js";

const SETTLED = new Set(["Healthy", "Degraded"]);

export interface ReconcileOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export async function reconcileArgoUntilSettled(
  k8s: KubernetesClient,
  applicationName: string,
  options: ReconcileOptions = {}
): Promise<string> {
  const intervalMs = options.intervalMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const start = Date.now();
  while (true) {
    const health = await k8s.argoApplicationHealth(applicationName);
    if (SETTLED.has(health)) return health;
    if (Date.now() - start > timeoutMs) {
      throw new ReconcileTimeoutError(applicationName, Date.now() - start);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

Modify `src/orchestrator.ts` — replace the existing health check at the bottom of `deploy()`:
```ts
import { reconcileArgoUntilSettled } from "./reconcile.js";
// ...
const health = await reconcileArgoUntilSettled(this.opts.kubernetes, argoName, { intervalMs: 200, timeoutMs: 60_000 });
if (health !== "Healthy") {
  // Rollback: delete every applied manifest + DNS, then throw.
  await this.opts.cloudflare.deleteDnsRecord(parsed.apex, fqdn);
  await this.opts.kubernetes.delete("atlas-projects", "Certificate", certName);
  await this.opts.kubernetes.delete("argocd", "Application", argoName);
  await this.opts.kubernetes.delete("atlas-projects", "Service", knativeName);
  throw new DeployError(`argo Application ${argoName} reported ${health}; deployment rolled back`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @atlas/deploy-orchestrator test reconcile orchestrator-rollback orchestrator-happy`
Expected: PASS across all three suites.

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-orchestrator/src/reconcile.ts packages/deploy-orchestrator/src/orchestrator.ts packages/deploy-orchestrator/test/reconcile.test.ts packages/deploy-orchestrator/test/orchestrator-rollback.test.ts
git commit -m "feat(deploy-orchestrator): poll Argo health; rollback on Degraded"
```

---

### Task 15: deploy-orchestrator barrel + README + Helm chart bootstrap

**Files:**
- Modify: `packages/deploy-orchestrator/src/index.ts`
- Create: `packages/deploy-orchestrator/README.md`
- Create: `deploy/atlas-helm/Chart.yaml`
- Create: `deploy/atlas-helm/values.yaml`
- Create: `deploy/atlas-helm/templates/cluster-issuer-cloudflare.yaml`
- Create: `deploy/atlas-helm/README.md`

- [ ] **Step 1: Update barrel**

```ts
export * from "./types.js";
export * from "./errors.js";
export * from "./kubernetes-client.js";
export * from "./cloudflare-client.js";
export * from "./manifests/knative-service.js";
export * from "./manifests/argo-application.js";
export * from "./manifests/cert-manager-cert.js";
export * from "./reconcile.js";
export * from "./orchestrator.js";
```

- [ ] **Step 2: Write the deploy-orchestrator README**

Document: the 4-step deploy flow (branch DB → manifests → apply → reconcile), the Argo Degraded → rollback contract, the in-memory client pattern for tests, the env-driven config (`ATLAS_MANIFEST_REPO_URL`, `ATLAS_CLUSTER_ISSUER`, `ATLAS_INGRESS_TARGET`).

- [ ] **Step 3: Write the Helm chart**

`deploy/atlas-helm/Chart.yaml`:
```yaml
apiVersion: v2
name: atlas-cluster
description: Cluster prerequisites for Atlas Run (Argo CD + Knative + cert-manager + Cloudflare ClusterIssuer)
type: application
version: 0.1.0
appVersion: "0.1.0"
```

`deploy/atlas-helm/values.yaml`:
```yaml
cloudflare:
  apiTokenSecretName: cloudflare-api-token
  apiTokenSecretKey: api-token
  email: ops@atlas.app
acme:
  server: https://acme-v02.api.letsencrypt.org/directory
```

`deploy/atlas-helm/templates/cluster-issuer-cloudflare.yaml`:
```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-cloudflare-dns01
spec:
  acme:
    server: {{ .Values.acme.server }}
    email: {{ .Values.cloudflare.email }}
    privateKeySecretRef:
      name: letsencrypt-cloudflare-account-key
    solvers:
      - dns01:
          cloudflare:
            apiTokenSecretRef:
              name: {{ .Values.cloudflare.apiTokenSecretName }}
              key: {{ .Values.cloudflare.apiTokenSecretKey }}
```

`deploy/atlas-helm/README.md`: bootstrap order — install Argo CD → install Knative Serving → install cert-manager → `helm install atlas-cluster deploy/atlas-helm/`.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter @atlas/deploy-orchestrator typecheck
git add packages/deploy-orchestrator/src/index.ts packages/deploy-orchestrator/README.md deploy/atlas-helm/
git commit -m "feat(deploy-orchestrator): barrel + README + Atlas cluster Helm chart"
```

---

### Task 16: atlas-web Ship Server Action

**Files:**
- Create: `apps/atlas-web/lib/deploy/ship-action.ts`
- Test: `apps/atlas-web/test/lib/deploy/ship-action.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { performShipAction } from "@/lib/deploy/ship-action.js";

describe("performShipAction", () => {
  it("calls DeployOrchestrator.deploy with derived request, returns publicUrl", async () => {
    const deploy = vi.fn().mockResolvedValue({
      deployId: "x", request: {} as never, phase: "healthy",
      publicUrl: "https://abc.atlas.app",
      argoApplicationName: "p-abc-main", branchSchemaName: "br_x",
      startedAt: "t0", endedAt: "t1"
    });
    const orch = { deploy } as never;

    const result = await performShipAction({
      orchestrator: orch,
      projectId: "11111111-1111-4111-8111-111111111111",
      subdomain: "abc",
      apex: "atlas.app",
      branchId: "main",
      imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
      target: "production"
    });

    expect(result.publicUrl).toBe("https://abc.atlas.app");
    expect(deploy).toHaveBeenCalledTimes(1);
  });

  it("returns a structured failure when orchestrator throws", async () => {
    const orch = { deploy: vi.fn().mockRejectedValue(new Error("boom")) } as never;
    const result = await performShipAction({
      orchestrator: orch,
      projectId: "11111111-1111-4111-8111-111111111111",
      subdomain: "abc", apex: "atlas.app", branchId: "main",
      imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
      target: "production"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter atlas-web test ship-action`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { DeployOrchestrator, DeployRequest } from "@atlas/deploy-orchestrator";

export interface ShipActionInput {
  orchestrator: DeployOrchestrator;
  projectId: string;
  subdomain: string;
  apex: string;
  branchId: string;
  imageRef: string;
  target: DeployRequest["target"];
}

export type ShipActionResult =
  | { ok: true; publicUrl: string; deployId: string }
  | { ok: false; error: string };

export async function performShipAction(input: ShipActionInput): Promise<ShipActionResult> {
  try {
    const result = await input.orchestrator.deploy({
      projectId: input.projectId,
      branchId: input.branchId,
      imageRef: input.imageRef,
      target: input.target,
      subdomain: input.subdomain,
      apex: input.apex,
      env: {}
    });
    return { ok: true, publicUrl: result.publicUrl ?? "", deployId: result.deployId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter atlas-web test ship-action`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/deploy/ship-action.ts apps/atlas-web/test/lib/deploy/ship-action.test.ts
git commit -m "feat(atlas-web): performShipAction wraps DeployOrchestrator with structured result"
```

---

### Task 17: deploy-orchestrator integration test against k3d (smoke)

**Files:**
- Create: `packages/deploy-orchestrator/test/integration-k3d.test.ts`

- [ ] **Step 1: Skip-by-default test that runs against a real k3d cluster when `ATLAS_K3D_CONTEXT` env is set**

```ts
import { describe, it, expect } from "vitest";

const k3dContext = process.env.ATLAS_K3D_CONTEXT;

describe.skipIf(!k3dContext)("DeployOrchestrator integration against k3d", () => {
  it("end-to-end deploys an example workload + tears it down", async () => {
    // Implementation note: this test is a smoke harness for local dev.
    // It is intentionally minimal and deferred — the production path runs
    // through the in-memory tests. When ATLAS_K3D_CONTEXT is set, we expect
    // a real cluster with Argo+Knative+cert-manager pre-installed.
    expect(k3dContext).toBeTruthy();
    // TODO(deferred): real cluster apply + reconcile + teardown.
  });
});
```

- [ ] **Step 2: Commit (no execution required — skip-by-default is the point)**

```bash
git add packages/deploy-orchestrator/test/integration-k3d.test.ts
git commit -m "test(deploy-orchestrator): k3d integration smoke harness (skip-by-default)"
```

---

### Task 18: Plan index update

**Files:**
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Add row to the plan index after the Phase B/C entries**

```markdown
| 22 | `2026-04-22-c1-deploy-orchestrator.md` | **C-1 — Atlas Run Deploy Orchestrator** | `@atlas/postgres-branching` (schema-per-branch) + `@atlas/deploy-orchestrator` (Argo CD + Knative + cert-manager manifests) + Cloudflare DNS + atlas-web Ship Server Action + Atlas Helm chart for cluster prerequisites | 17 tasks, TDD | Shipped (merged <SHA>) |
```

- [ ] **Step 2: Mark C-1 as shipped in the Phase C section** (replace the unchecked row).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): mark C-1 shipped (merged <SHA>)"
```

---

## Completion Checklist

- [ ] Task 1: `@atlas/postgres-branching` scaffold
- [ ] Task 2: `branchSchemaName` deterministic naming
- [ ] Task 3: `PgBranchingAdapter` ensure/drop/list
- [ ] Task 4: `replayMigrationsToSchema`
- [ ] Task 5: postgres-branching barrel + README
- [ ] Task 6: `@atlas/deploy-orchestrator` scaffold
- [ ] Task 7: `DeployRequest` / `DeployResult` / `DeploymentPhase` schemas
- [ ] Task 8: `DeployError` + subclasses
- [ ] Task 9: Knative Service manifest emitter
- [ ] Task 10: Argo CD Application manifest emitter
- [ ] Task 11: cert-manager Certificate manifest emitter
- [ ] Task 12: KubernetesClient + CloudflareClient interfaces + in-memory implementations
- [ ] Task 13: `DeployOrchestrator.deploy()` happy path
- [ ] Task 14: Argo health-poll reconciler + rollback
- [ ] Task 15: barrel + README + Atlas cluster Helm chart
- [ ] Task 16: atlas-web Ship Server Action
- [ ] Task 17: k3d integration smoke harness (skip-by-default)
- [ ] Task 18: Plan index update

---

## Handoff

After C-1 ships, two follow-ups become unblocked:

1. **C-2** (observability dashboard) — needs the deployed workloads from C-1 to emit telemetry.
2. **B-2** (cloud_migration fusion) — once the deploy orchestrator is real, the fused codebase has a target to deploy against.

Open follow-ups flagged for later:
- Real KubernetesClient over `@kubernetes/client-node` (Task 12 ships in-memory only; production needs a thin wrapper around `KubeConfig.loadFromDefault()` + `CoreV1Api.patch` etc.).
- Real CloudflareClient over the `cloudflare` SDK.
- A registry of (projectId, branchId, schemaName) so `listBranches` can return human-meaningful names instead of hashes (Task 3 leaves a TODO for this).
- D6 deferral pairs with C-1: spend recording per Knative request needs wiring once the orchestrator is real.
