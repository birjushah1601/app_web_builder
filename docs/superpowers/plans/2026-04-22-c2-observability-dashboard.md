# C-2 — Atlas Run Observability Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the platform-side observability stack (OpenTelemetry collector + Prometheus + Grafana + Loki, deployed via Helm) and a persona-tiered Run dashboard in atlas-web that surfaces app health to Ama (traffic lights), Diego (per-endpoint p95 + error rate), and Priya (full trace explorer + alerting policy editor). User-app exception capture goes through GlitchTip, bundled into the Atlas Run deploy template.

**Architecture:** Per ADR-001 §4 (resolved 2026-04-22) the observability stack is two-layered:

- **Platform telemetry** — every Atlas service (conductor, role-*, deploy-orchestrator, sandbox-e2b, ritual-engine) emits OpenTelemetry traces + Prometheus metrics over OTLP to a collector. The collector fans out to Prometheus (metrics), Loki (logs), and Tempo (traces). Grafana dashboards read from all three. The `@atlas/observability` package provides the shared OTel + Prom-client setup so every service speaks the same shape.

- **User-app exception capture** — apps deployed via the C-1 orchestrator get a Sentry-protocol-compatible SDK preconfigured against a GlitchTip instance. The orchestrator injects `SENTRY_DSN` into the Knative Service env. Users opt out with `ATLAS_DISABLE_ERROR_TRACKING=1`.

The atlas-web Run dashboard is a Next.js Server Component that fetches from a Grafana data-source endpoint (proxy to Prometheus + Loki + Tempo) and renders three persona-tiered views from the same underlying data.

**Tech Stack:** TypeScript 5.6.3, Zod 3.23.8, Vitest 2.1.8, `@opentelemetry/sdk-node` 0.55, `@opentelemetry/exporter-trace-otlp-proto` 0.55, `@opentelemetry/exporter-metrics-otlp-proto` 0.55, `prom-client` 15.1 (already in tree). Grafana / Prometheus / Loki / Tempo / GlitchTip ship via Helm — code in this plan emits chart values, no chart authoring.

**Prerequisites:**
- C-1 merged (`@atlas/deploy-orchestrator` ships the orchestrator that injects `SENTRY_DSN`).
- ADR-001 merged (`e0e7a56` + `2b3410b`).
- Cluster prerequisites from C-1's `deploy/atlas-helm/` are deployed (Argo CD reconciles the observability stack via this plan's chart additions).

---

## File Structure

```
packages/observability/
├── package.json                            # @atlas/observability
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── src/
│   ├── index.ts                            # barrel exports
│   ├── otel-bootstrap.ts                   # initOtelSdk(serviceName, env) — single entry point for every service
│   ├── prom-bootstrap.ts                   # initPromRegistry(serviceName) — singleton Prometheus registry
│   ├── traceAttributes.ts                  # standardized span attributes (atlas.project_id, atlas.role_id, etc.)
│   └── logger.ts                           # bundled pino+OTel-context logger
└── test/
    ├── otel-bootstrap.test.ts
    ├── prom-bootstrap.test.ts
    └── traceAttributes.test.ts

packages/run-dashboard/
├── package.json                            # @atlas/run-dashboard
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── src/
│   ├── index.ts
│   ├── types.ts                            # PersonaTier, HealthSummary, EndpointStat, TraceLink
│   ├── grafana-client.ts                   # GrafanaClient interface + InMemory + Real
│   ├── compute-health.ts                   # raw metrics → HealthSummary
│   ├── compute-endpoint-stats.ts           # raw metrics → EndpointStat[]
│   └── errors.ts
└── test/
    ├── grafana-client.test.ts
    ├── compute-health.test.ts
    └── compute-endpoint-stats.test.ts

deploy/atlas-helm/templates/
├── prometheus-helm-release.yaml            # references kube-prometheus-stack via Argo CD ApplicationSet
├── loki-helm-release.yaml
├── tempo-helm-release.yaml
├── grafana-helm-release.yaml
├── opentelemetry-collector.yaml            # OTel collector Deployment + ConfigMap
└── glitchtip-helm-release.yaml

apps/atlas-web/
├── app/projects/[projectId]/run/
│   ├── page.tsx                            # Run dashboard server component
│   └── _components/
│       ├── HealthLightsAma.tsx             # Ama persona view
│       ├── EndpointTableDiego.tsx          # Diego persona view
│       └── TraceExplorerPriya.tsx          # Priya persona view
└── test/components/
    ├── HealthLightsAma.test.tsx
    ├── EndpointTableDiego.test.tsx
    └── TraceExplorerPriya.test.tsx
```

---

## Types & Contracts

```ts
// packages/run-dashboard/src/types.ts
export const PersonaTierSchema = z.enum(["ama", "diego", "priya"]);
export type PersonaTier = z.infer<typeof PersonaTierSchema>;

export const HealthLightSchema = z.enum(["green", "amber", "red", "unknown"]);
export type HealthLight = z.infer<typeof HealthLightSchema>;

export const HealthSummarySchema = z.object({
  light: HealthLightSchema,
  /** Achieved availability over the dashboard window. */
  availabilityRatio: z.number().min(0).max(1),
  /** Number of OPEN burn-rate alerts. */
  openAlerts: z.number().int().nonnegative(),
  /** Window ISO. */
  windowFromIso: z.string().datetime(),
  windowToIso: z.string().datetime()
}).strict();
export type HealthSummary = z.infer<typeof HealthSummarySchema>;

export const EndpointStatSchema = z.object({
  endpointId: z.string().min(1),                  // e.g., "GET /api/users"
  requestCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  p99Ms: z.number().nonnegative()
}).strict();
export type EndpointStat = z.infer<typeof EndpointStatSchema>;

export const TraceLinkSchema = z.object({
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
  rootEndpoint: z.string().min(1),
  durationMs: z.number().nonnegative(),
  errorOccurred: z.boolean(),
  startedAtIso: z.string().datetime()
}).strict();
export type TraceLink = z.infer<typeof TraceLinkSchema>;
```

---

### Task 1: Scaffold `@atlas/observability` package

**Files:**
- Create: `packages/observability/package.json`
- Create: `packages/observability/tsconfig.json`
- Create: `packages/observability/vitest.config.ts`
- Create: `packages/observability/src/index.ts`
- Test: `packages/observability/test/scaffold.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import * as pkg from "../src/index.js";
describe("@atlas/observability barrel", () => {
  it("exposes a stable barrel", () => { expect(pkg).toBeDefined(); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/observability test`
Expected: FAIL.

- [ ] **Step 3: Write minimal package.json**

```json
{
  "name": "@atlas/observability",
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
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/sdk-node": "^0.55.0",
    "@opentelemetry/exporter-trace-otlp-proto": "^0.55.0",
    "@opentelemetry/exporter-metrics-otlp-proto": "^0.55.0",
    "@opentelemetry/resources": "^1.28.0",
    "@opentelemetry/semantic-conventions": "^1.28.0",
    "prom-client": "^15.1.0",
    "pino": "^9.5.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

`tsconfig.json` + `vitest.config.ts`: same shape as `@atlas/audit-log`.
`src/index.ts`: `export {};`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm install && pnpm --filter @atlas/observability test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/observability/ pnpm-lock.yaml
git commit -m "feat(observability): scaffold package"
```

---

### Task 2: `traceAttributes` — standardized span attribute keys

**Files:**
- Create: `packages/observability/src/traceAttributes.ts`
- Test: `packages/observability/test/traceAttributes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ATLAS_ATTRS, buildAtlasResourceAttributes } from "../src/traceAttributes.js";

describe("ATLAS_ATTRS", () => {
  it("exports the documented attribute keys", () => {
    expect(ATLAS_ATTRS.PROJECT_ID).toBe("atlas.project_id");
    expect(ATLAS_ATTRS.ROLE_ID).toBe("atlas.role_id");
    expect(ATLAS_ATTRS.RITUAL_ID).toBe("atlas.ritual_id");
    expect(ATLAS_ATTRS.GATE_LAYER).toBe("atlas.gate_layer");
    expect(ATLAS_ATTRS.BRANCH_ID).toBe("atlas.branch_id");
    expect(ATLAS_ATTRS.LLM_PROVIDER).toBe("atlas.llm.provider");
    expect(ATLAS_ATTRS.LLM_MODEL).toBe("atlas.llm.model");
    expect(ATLAS_ATTRS.SKILL_NAME).toBe("atlas.skill.name");
  });
});

describe("buildAtlasResourceAttributes", () => {
  it("returns service.name + service.version + atlas.deploy_target keys", () => {
    const attrs = buildAtlasResourceAttributes({
      serviceName: "atlas-conductor",
      serviceVersion: "0.0.0",
      deployTarget: "production"
    });
    expect(attrs["service.name"]).toBe("atlas-conductor");
    expect(attrs["service.version"]).toBe("0.0.0");
    expect(attrs["atlas.deploy_target"]).toBe("production");
  });

  it("rejects empty serviceName", () => {
    expect(() =>
      buildAtlasResourceAttributes({ serviceName: "", serviceVersion: "0", deployTarget: "production" })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/observability test traceAttributes`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
export const ATLAS_ATTRS = {
  PROJECT_ID: "atlas.project_id",
  ROLE_ID: "atlas.role_id",
  RITUAL_ID: "atlas.ritual_id",
  GATE_LAYER: "atlas.gate_layer",
  BRANCH_ID: "atlas.branch_id",
  DEPLOY_TARGET: "atlas.deploy_target",
  LLM_PROVIDER: "atlas.llm.provider",
  LLM_MODEL: "atlas.llm.model",
  SKILL_NAME: "atlas.skill.name"
} as const;

export interface ResourceAttributesInput {
  serviceName: string;
  serviceVersion: string;
  deployTarget: "production" | "preview";
}

export function buildAtlasResourceAttributes(input: ResourceAttributesInput): Record<string, string> {
  if (!input.serviceName) throw new Error("serviceName must be non-empty");
  return {
    "service.name": input.serviceName,
    "service.version": input.serviceVersion,
    [ATLAS_ATTRS.DEPLOY_TARGET]: input.deployTarget
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/observability test traceAttributes`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/traceAttributes.ts packages/observability/test/traceAttributes.test.ts
git commit -m "feat(observability): standardized atlas.* span attributes + resource builder"
```

---

### Task 3: Prometheus registry singleton + named-counter helpers

**Files:**
- Create: `packages/observability/src/prom-bootstrap.ts`
- Test: `packages/observability/test/prom-bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { initPromRegistry, getPromRegistry, resetPromRegistry } from "../src/prom-bootstrap.js";

describe("initPromRegistry", () => {
  beforeEach(() => resetPromRegistry());

  it("returns a registry with the atlas service-name label preset", () => {
    initPromRegistry({ serviceName: "atlas-test", serviceVersion: "0.0.0" });
    const reg = getPromRegistry();
    const metrics = reg.getMetricsAsArray();
    // The default metrics include process_cpu_seconds_total — the registry is wired.
    expect(metrics.length).toBeGreaterThan(0);
  });

  it("is idempotent — second init reuses the same registry", () => {
    initPromRegistry({ serviceName: "x", serviceVersion: "0" });
    const a = getPromRegistry();
    initPromRegistry({ serviceName: "x", serviceVersion: "0" });
    const b = getPromRegistry();
    expect(a).toBe(b);
  });

  it("getPromRegistry throws if init never ran", () => {
    expect(() => getPromRegistry()).toThrow(/initPromRegistry/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/observability test prom-bootstrap`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import { Registry, collectDefaultMetrics } from "prom-client";

export interface PromInitOptions {
  serviceName: string;
  serviceVersion: string;
}

let registry: Registry | null = null;

export function initPromRegistry(opts: PromInitOptions): Registry {
  if (registry) return registry;
  registry = new Registry();
  registry.setDefaultLabels({
    service: opts.serviceName,
    version: opts.serviceVersion
  });
  collectDefaultMetrics({ register: registry });
  return registry;
}

export function getPromRegistry(): Registry {
  if (!registry) throw new Error("initPromRegistry must be called before getPromRegistry");
  return registry;
}

/** Test helper. Production code should never call this. */
export function resetPromRegistry(): void {
  registry = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/observability test prom-bootstrap`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/prom-bootstrap.ts packages/observability/test/prom-bootstrap.test.ts
git commit -m "feat(observability): Prometheus registry singleton with atlas labels"
```

---

### Task 4: OTel SDK bootstrap (no-op exporter for tests, OTLP for prod)

**Files:**
- Create: `packages/observability/src/otel-bootstrap.ts`
- Test: `packages/observability/test/otel-bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { initOtelSdk, shutdownOtelSdk } from "../src/otel-bootstrap.js";

describe("initOtelSdk", () => {
  it("starts the SDK and returns a shutdown handle", async () => {
    await initOtelSdk({
      serviceName: "atlas-test",
      serviceVersion: "0.0.0",
      deployTarget: "production",
      exporterMode: "noop"
    });
    await shutdownOtelSdk();
  });

  it("is idempotent — second init is a no-op", async () => {
    await initOtelSdk({ serviceName: "x", serviceVersion: "0", deployTarget: "preview", exporterMode: "noop" });
    await initOtelSdk({ serviceName: "x", serviceVersion: "0", deployTarget: "preview", exporterMode: "noop" });
    await shutdownOtelSdk();
  });

  it("reads OTEL_EXPORTER_OTLP_ENDPOINT for production exporter", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4318";
    await initOtelSdk({
      serviceName: "x", serviceVersion: "0", deployTarget: "production", exporterMode: "otlp-proto"
    });
    await shutdownOtelSdk();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/observability test otel-bootstrap`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Resource } from "@opentelemetry/resources";
import { buildAtlasResourceAttributes } from "./traceAttributes.js";

export interface OtelInitOptions {
  serviceName: string;
  serviceVersion: string;
  deployTarget: "production" | "preview";
  /** "noop" for tests; "otlp-proto" for real deploys. */
  exporterMode: "noop" | "otlp-proto";
}

let sdk: NodeSDK | null = null;

export async function initOtelSdk(opts: OtelInitOptions): Promise<void> {
  if (sdk) return;
  const resource = new Resource(
    buildAtlasResourceAttributes({
      serviceName: opts.serviceName,
      serviceVersion: opts.serviceVersion,
      deployTarget: opts.deployTarget
    })
  );
  const traceExporter =
    opts.exporterMode === "otlp-proto"
      ? new OTLPTraceExporter({
          url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://otel-collector:4318"}/v1/traces`
        })
      : undefined;
  sdk = new NodeSDK({ resource, traceExporter });
  sdk.start();
}

export async function shutdownOtelSdk(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/observability test otel-bootstrap`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/otel-bootstrap.ts packages/observability/test/otel-bootstrap.test.ts
git commit -m "feat(observability): OTel SDK bootstrap with noop + otlp-proto exporter modes"
```

---

### Task 5: pino+OTel-context logger + barrel + README

**Files:**
- Create: `packages/observability/src/logger.ts`
- Modify: `packages/observability/src/index.ts`
- Create: `packages/observability/README.md`

- [ ] **Step 1: Write the logger**

```ts
import { context, trace } from "@opentelemetry/api";
import pino from "pino";

export interface AtlasLoggerOptions {
  serviceName: string;
  level?: pino.Level;
}

export function createAtlasLogger(opts: AtlasLoggerOptions): pino.Logger {
  const base = pino({
    level: opts.level ?? "info",
    base: { service: opts.serviceName },
    formatters: {
      log(obj) {
        const span = trace.getSpan(context.active());
        if (span) {
          const ctx = span.spanContext();
          return { ...obj, trace_id: ctx.traceId, span_id: ctx.spanId };
        }
        return obj;
      }
    }
  });
  return base;
}
```

- [ ] **Step 2: Update barrel**

```ts
export * from "./traceAttributes.js";
export * from "./prom-bootstrap.js";
export * from "./otel-bootstrap.js";
export * from "./logger.js";
```

- [ ] **Step 3: Write the README**

Document: when to call `initOtelSdk` (process startup, before any other Atlas code), when to call `initPromRegistry` (same), how `createAtlasLogger` auto-stamps `trace_id` + `span_id` from the active OTel context, and the canonical `ATLAS_ATTRS` keys every role / orchestrator / gate must use.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter @atlas/observability typecheck
git add packages/observability/src/logger.ts packages/observability/src/index.ts packages/observability/README.md
git commit -m "feat(observability): atlas logger with OTel context stamping + README"
```

---

### Task 6: Scaffold `@atlas/run-dashboard` package

**Files:**
- Create: `packages/run-dashboard/package.json`
- Create: `packages/run-dashboard/tsconfig.json`
- Create: `packages/run-dashboard/vitest.config.ts`
- Create: `packages/run-dashboard/src/index.ts`
- Test: `packages/run-dashboard/test/scaffold.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import * as pkg from "../src/index.js";
describe("@atlas/run-dashboard barrel", () => {
  it("exposes a stable barrel", () => { expect(pkg).toBeDefined(); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/run-dashboard test`
Expected: FAIL.

- [ ] **Step 3: Write the package**

`package.json`:
```json
{
  "name": "@atlas/run-dashboard",
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
    "@atlas/slo-engine": "workspace:*",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

`tsconfig.json` + `vitest.config.ts`: same shape as `@atlas/audit-log`.
`src/index.ts`: `export {};`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm install && pnpm --filter @atlas/run-dashboard test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/run-dashboard/ pnpm-lock.yaml
git commit -m "feat(run-dashboard): scaffold package"
```

---

### Task 7: types.ts — PersonaTier, HealthSummary, EndpointStat, TraceLink

**Files:**
- Create: `packages/run-dashboard/src/types.ts`
- Test: `packages/run-dashboard/test/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  PersonaTierSchema,
  HealthSummarySchema,
  EndpointStatSchema,
  TraceLinkSchema
} from "../src/types.js";

describe("PersonaTierSchema", () => {
  it("accepts ama / diego / priya", () => {
    for (const p of ["ama", "diego", "priya"]) {
      expect(PersonaTierSchema.safeParse(p).success).toBe(true);
    }
  });
  it("rejects unknown personas", () => {
    expect(PersonaTierSchema.safeParse("admin").success).toBe(false);
  });
});

describe("HealthSummarySchema", () => {
  it("accepts a green summary", () => {
    expect(
      HealthSummarySchema.safeParse({
        light: "green",
        availabilityRatio: 0.999,
        openAlerts: 0,
        windowFromIso: "2026-04-22T00:00:00.000Z",
        windowToIso: "2026-04-22T01:00:00.000Z"
      }).success
    ).toBe(true);
  });
  it("rejects availabilityRatio > 1", () => {
    expect(
      HealthSummarySchema.safeParse({
        light: "green", availabilityRatio: 1.5, openAlerts: 0,
        windowFromIso: "2026-04-22T00:00:00.000Z",
        windowToIso: "2026-04-22T01:00:00.000Z"
      }).success
    ).toBe(false);
  });
});

describe("EndpointStatSchema", () => {
  it("accepts a valid endpoint stat", () => {
    expect(
      EndpointStatSchema.safeParse({
        endpointId: "GET /api/users",
        requestCount: 1000,
        errorCount: 3,
        p50Ms: 80,
        p95Ms: 400,
        p99Ms: 800
      }).success
    ).toBe(true);
  });
  it("rejects negative latency", () => {
    expect(
      EndpointStatSchema.safeParse({
        endpointId: "x", requestCount: 0, errorCount: 0, p50Ms: -1, p95Ms: 0, p99Ms: 0
      }).success
    ).toBe(false);
  });
});

describe("TraceLinkSchema", () => {
  it("requires a 32-char hex traceId", () => {
    expect(
      TraceLinkSchema.safeParse({
        traceId: "0".repeat(32),
        rootEndpoint: "GET /",
        durationMs: 100,
        errorOccurred: false,
        startedAtIso: "2026-04-22T00:00:00.000Z"
      }).success
    ).toBe(true);
    expect(
      TraceLinkSchema.safeParse({
        traceId: "abc",
        rootEndpoint: "GET /",
        durationMs: 100,
        errorOccurred: false,
        startedAtIso: "2026-04-22T00:00:00.000Z"
      }).success
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/run-dashboard test types`
Expected: FAIL.

- [ ] **Step 3: Write the schemas (per the Types & Contracts section above)**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/run-dashboard test types`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/run-dashboard/src/types.ts packages/run-dashboard/test/types.test.ts
git commit -m "feat(run-dashboard): PersonaTier + HealthSummary + EndpointStat + TraceLink schemas"
```

---

### Task 8: GrafanaClient interface + InMemoryGrafanaClient

**Files:**
- Create: `packages/run-dashboard/src/grafana-client.ts`
- Test: `packages/run-dashboard/test/grafana-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { InMemoryGrafanaClient } from "../src/grafana-client.js";

describe("InMemoryGrafanaClient", () => {
  it("queryRange returns whatever was preloaded", async () => {
    const c = new InMemoryGrafanaClient();
    c.preloadRange("up{service=\"x\"}", [{ ts: "2026-04-22T00:00:00.000Z", value: 1 }]);
    const result = await c.queryRange({
      query: 'up{service="x"}',
      fromIso: "2026-04-22T00:00:00.000Z",
      toIso: "2026-04-22T01:00:00.000Z"
    });
    expect(result.points).toEqual([{ ts: "2026-04-22T00:00:00.000Z", value: 1 }]);
  });

  it("queryInstant returns the preloaded value", async () => {
    const c = new InMemoryGrafanaClient();
    c.preloadInstant("sum(rate(http_requests_total[5m]))", 42);
    const result = await c.queryInstant({ query: "sum(rate(http_requests_total[5m]))" });
    expect(result.value).toBe(42);
  });

  it("queryInstant throws for unknown query", async () => {
    const c = new InMemoryGrafanaClient();
    await expect(c.queryInstant({ query: "nope" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/run-dashboard test grafana-client`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface PromQueryRangeInput {
  query: string;
  fromIso: string;
  toIso: string;
  /** Step in seconds. */
  stepSec?: number;
}

export interface PromQueryRangeResult {
  query: string;
  points: Array<{ ts: string; value: number }>;
}

export interface PromQueryInstantInput {
  query: string;
  atIso?: string;
}

export interface PromQueryInstantResult {
  query: string;
  value: number;
  atIso: string;
}

export interface GrafanaClient {
  queryRange(input: PromQueryRangeInput): Promise<PromQueryRangeResult>;
  queryInstant(input: PromQueryInstantInput): Promise<PromQueryInstantResult>;
}

export class InMemoryGrafanaClient implements GrafanaClient {
  private readonly ranges = new Map<string, Array<{ ts: string; value: number }>>();
  private readonly instants = new Map<string, number>();

  preloadRange(query: string, points: Array<{ ts: string; value: number }>): void {
    this.ranges.set(query, points);
  }

  preloadInstant(query: string, value: number): void {
    this.instants.set(query, value);
  }

  async queryRange(input: PromQueryRangeInput): Promise<PromQueryRangeResult> {
    const points = this.ranges.get(input.query);
    if (!points) throw new Error(`InMemoryGrafanaClient: no range data for query "${input.query}"`);
    return { query: input.query, points };
  }

  async queryInstant(input: PromQueryInstantInput): Promise<PromQueryInstantResult> {
    if (!this.instants.has(input.query)) {
      throw new Error(`InMemoryGrafanaClient: no instant data for query "${input.query}"`);
    }
    return {
      query: input.query,
      value: this.instants.get(input.query)!,
      atIso: input.atIso ?? new Date().toISOString()
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/run-dashboard test grafana-client`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/run-dashboard/src/grafana-client.ts packages/run-dashboard/test/grafana-client.test.ts
git commit -m "feat(run-dashboard): GrafanaClient interface + InMemoryGrafanaClient"
```

---

### Task 9: `computeHealthSummary()` — derive HealthSummary from Prometheus queries

**Files:**
- Create: `packages/run-dashboard/src/compute-health.ts`
- Test: `packages/run-dashboard/test/compute-health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeHealthSummary } from "../src/compute-health.js";
import { InMemoryGrafanaClient } from "../src/grafana-client.js";

describe("computeHealthSummary", () => {
  it("returns green when availability >= 0.999 and openAlerts=0", async () => {
    const c = new InMemoryGrafanaClient();
    c.preloadInstant("atlas_availability_ratio", 0.9995);
    c.preloadInstant("atlas_open_burn_alerts", 0);
    const result = await computeHealthSummary(c, {
      windowFromIso: "2026-04-22T00:00:00.000Z",
      windowToIso: "2026-04-22T01:00:00.000Z"
    });
    expect(result.light).toBe("green");
    expect(result.availabilityRatio).toBeCloseTo(0.9995);
    expect(result.openAlerts).toBe(0);
  });

  it("returns amber when availability >= 0.99 but < 0.999 OR openAlerts > 0", async () => {
    const c = new InMemoryGrafanaClient();
    c.preloadInstant("atlas_availability_ratio", 0.995);
    c.preloadInstant("atlas_open_burn_alerts", 0);
    const result = await computeHealthSummary(c, {
      windowFromIso: "2026-04-22T00:00:00.000Z",
      windowToIso: "2026-04-22T01:00:00.000Z"
    });
    expect(result.light).toBe("amber");
  });

  it("returns red when availability < 0.99", async () => {
    const c = new InMemoryGrafanaClient();
    c.preloadInstant("atlas_availability_ratio", 0.95);
    c.preloadInstant("atlas_open_burn_alerts", 1);
    const result = await computeHealthSummary(c, {
      windowFromIso: "2026-04-22T00:00:00.000Z",
      windowToIso: "2026-04-22T01:00:00.000Z"
    });
    expect(result.light).toBe("red");
  });

  it("returns unknown when queries throw", async () => {
    const c = new InMemoryGrafanaClient();
    const result = await computeHealthSummary(c, {
      windowFromIso: "2026-04-22T00:00:00.000Z",
      windowToIso: "2026-04-22T01:00:00.000Z"
    });
    expect(result.light).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/run-dashboard test compute-health`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { GrafanaClient } from "./grafana-client.js";
import { HealthSummarySchema, type HealthSummary } from "./types.js";

export interface ComputeHealthInput {
  windowFromIso: string;
  windowToIso: string;
  /** PromQL string for the availability ratio. Defaults to atlas_availability_ratio. */
  availabilityQuery?: string;
  /** PromQL string for the open-alert count. Defaults to atlas_open_burn_alerts. */
  alertsQuery?: string;
}

export async function computeHealthSummary(
  grafana: GrafanaClient,
  input: ComputeHealthInput
): Promise<HealthSummary> {
  try {
    const [avail, alerts] = await Promise.all([
      grafana.queryInstant({ query: input.availabilityQuery ?? "atlas_availability_ratio" }),
      grafana.queryInstant({ query: input.alertsQuery ?? "atlas_open_burn_alerts" })
    ]);
    let light: HealthSummary["light"];
    if (avail.value < 0.99 || alerts.value >= 2) light = "red";
    else if (avail.value < 0.999 || alerts.value > 0) light = "amber";
    else light = "green";
    return HealthSummarySchema.parse({
      light,
      availabilityRatio: avail.value,
      openAlerts: Math.floor(alerts.value),
      windowFromIso: input.windowFromIso,
      windowToIso: input.windowToIso
    });
  } catch {
    return HealthSummarySchema.parse({
      light: "unknown",
      availabilityRatio: 0,
      openAlerts: 0,
      windowFromIso: input.windowFromIso,
      windowToIso: input.windowToIso
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/run-dashboard test compute-health`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/run-dashboard/src/compute-health.ts packages/run-dashboard/test/compute-health.test.ts
git commit -m "feat(run-dashboard): computeHealthSummary derives green/amber/red from Prom queries"
```

---

### Task 10: `computeEndpointStats()` — Diego-tier per-endpoint table data

**Files:**
- Create: `packages/run-dashboard/src/compute-endpoint-stats.ts`
- Test: `packages/run-dashboard/test/compute-endpoint-stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeEndpointStats, parsePromEndpointSeries } from "../src/compute-endpoint-stats.js";

describe("parsePromEndpointSeries", () => {
  it("parses a series with endpoint label", () => {
    const series = [
      { metric: { endpoint: "GET /a" }, value: 100 },
      { metric: { endpoint: "POST /b" }, value: 50 }
    ];
    expect(parsePromEndpointSeries(series, "value")).toEqual({
      "GET /a": 100,
      "POST /b": 50
    });
  });
});

describe("computeEndpointStats", () => {
  it("merges per-endpoint metrics into EndpointStat[] sorted by requestCount desc", () => {
    const requests = { "GET /a": 1000, "POST /b": 50 };
    const errors = { "GET /a": 3, "POST /b": 0 };
    const p50 = { "GET /a": 80, "POST /b": 20 };
    const p95 = { "GET /a": 400, "POST /b": 60 };
    const p99 = { "GET /a": 800, "POST /b": 100 };
    const stats = computeEndpointStats({ requests, errors, p50, p95, p99 });
    expect(stats[0]?.endpointId).toBe("GET /a");
    expect(stats[0]?.requestCount).toBe(1000);
    expect(stats[0]?.errorCount).toBe(3);
    expect(stats[0]?.p95Ms).toBe(400);
    expect(stats[1]?.endpointId).toBe("POST /b");
  });

  it("uses 0 for missing per-endpoint values", () => {
    const stats = computeEndpointStats({
      requests: { "GET /x": 10 },
      errors: {},
      p50: {},
      p95: {},
      p99: {}
    });
    expect(stats[0]?.errorCount).toBe(0);
    expect(stats[0]?.p50Ms).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/run-dashboard test compute-endpoint-stats`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
import { EndpointStatSchema, type EndpointStat } from "./types.js";

export function parsePromEndpointSeries(
  series: Array<{ metric: Record<string, string>; value: number }>,
  _kind: string
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const point of series) {
    const ep = point.metric.endpoint;
    if (!ep) continue;
    out[ep] = point.value;
  }
  return out;
}

export interface ComputeEndpointStatsInput {
  requests: Record<string, number>;
  errors: Record<string, number>;
  p50: Record<string, number>;
  p95: Record<string, number>;
  p99: Record<string, number>;
}

export function computeEndpointStats(input: ComputeEndpointStatsInput): EndpointStat[] {
  const allEndpoints = new Set<string>([
    ...Object.keys(input.requests),
    ...Object.keys(input.errors),
    ...Object.keys(input.p50),
    ...Object.keys(input.p95),
    ...Object.keys(input.p99)
  ]);
  const stats: EndpointStat[] = [];
  for (const ep of allEndpoints) {
    stats.push(
      EndpointStatSchema.parse({
        endpointId: ep,
        requestCount: input.requests[ep] ?? 0,
        errorCount: input.errors[ep] ?? 0,
        p50Ms: input.p50[ep] ?? 0,
        p95Ms: input.p95[ep] ?? 0,
        p99Ms: input.p99[ep] ?? 0
      })
    );
  }
  stats.sort((a, b) => b.requestCount - a.requestCount);
  return stats;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/run-dashboard test compute-endpoint-stats`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/run-dashboard/src/compute-endpoint-stats.ts packages/run-dashboard/test/compute-endpoint-stats.test.ts
git commit -m "feat(run-dashboard): computeEndpointStats merges per-endpoint Prom series"
```

---

### Task 11: run-dashboard barrel + README

**Files:**
- Modify: `packages/run-dashboard/src/index.ts`
- Create: `packages/run-dashboard/README.md`

- [ ] **Step 1: Update barrel**

```ts
export * from "./types.js";
export * from "./grafana-client.js";
export * from "./compute-health.js";
export * from "./compute-endpoint-stats.js";
```

- [ ] **Step 2: Write the README**

Document: the persona-tiered model (one data source, three views), `GrafanaClient` as the seam (in-memory for tests, real HTTP for prod), and the canonical PromQL queries — `atlas_availability_ratio`, `atlas_open_burn_alerts`, `atlas_endpoint_requests_total`, `atlas_endpoint_errors_total`, `atlas_endpoint_latency_p50/p95/p99_ms`. These names match the Prometheus metrics emitted by `@atlas/observability` consumers.

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @atlas/run-dashboard typecheck
git add packages/run-dashboard/src/index.ts packages/run-dashboard/README.md
git commit -m "docs(run-dashboard): README + barrel exports"
```

---

### Task 12: Ama persona view — `HealthLightsAma` component

**Files:**
- Create: `apps/atlas-web/app/projects/[projectId]/run/_components/HealthLightsAma.tsx`
- Test: `apps/atlas-web/test/components/HealthLightsAma.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthLightsAma } from "@/app/projects/[projectId]/run/_components/HealthLightsAma.js";

describe("HealthLightsAma", () => {
  it("renders a green light for healthy summary", () => {
    render(
      <HealthLightsAma
        summary={{
          light: "green",
          availabilityRatio: 0.9995,
          openAlerts: 0,
          windowFromIso: "2026-04-22T00:00:00.000Z",
          windowToIso: "2026-04-22T01:00:00.000Z"
        }}
      />
    );
    expect(screen.getByTestId("health-light")).toHaveAttribute("data-light", "green");
    expect(screen.getByText(/all systems normal/i)).toBeInTheDocument();
  });

  it("renders amber light + supportive copy", () => {
    render(
      <HealthLightsAma
        summary={{
          light: "amber",
          availabilityRatio: 0.995,
          openAlerts: 1,
          windowFromIso: "2026-04-22T00:00:00.000Z",
          windowToIso: "2026-04-22T01:00:00.000Z"
        }}
      />
    );
    expect(screen.getByTestId("health-light")).toHaveAttribute("data-light", "amber");
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  });

  it("renders red light + actionable copy", () => {
    render(
      <HealthLightsAma
        summary={{
          light: "red",
          availabilityRatio: 0.9,
          openAlerts: 3,
          windowFromIso: "2026-04-22T00:00:00.000Z",
          windowToIso: "2026-04-22T01:00:00.000Z"
        }}
      />
    );
    expect(screen.getByTestId("health-light")).toHaveAttribute("data-light", "red");
    expect(screen.getByText(/urgent/i)).toBeInTheDocument();
  });

  it("renders unknown state with neutral copy", () => {
    render(
      <HealthLightsAma
        summary={{
          light: "unknown",
          availabilityRatio: 0,
          openAlerts: 0,
          windowFromIso: "2026-04-22T00:00:00.000Z",
          windowToIso: "2026-04-22T01:00:00.000Z"
        }}
      />
    );
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter atlas-web test HealthLightsAma`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```tsx
import type { HealthSummary } from "@atlas/run-dashboard";

const COPY: Record<HealthSummary["light"], { headline: string; sub: string }> = {
  green: { headline: "All systems normal", sub: "Your app is healthy." },
  amber: { headline: "Needs attention", sub: "A degradation is in progress — your developer should investigate." },
  red: { headline: "Urgent — your app is unhealthy", sub: "Users are affected. Page your on-call." },
  unknown: { headline: "No data yet", sub: "Telemetry has not arrived yet — check back in a few minutes." }
};

const COLORS: Record<HealthSummary["light"], string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-600",
  unknown: "bg-zinc-400"
};

export function HealthLightsAma({ summary }: { summary: HealthSummary }) {
  const copy = COPY[summary.light];
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6">
      <div className="flex items-center gap-4">
        <div
          data-testid="health-light"
          data-light={summary.light}
          className={`h-16 w-16 rounded-full ${COLORS[summary.light]}`}
        />
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">{copy.headline}</h2>
          <p className="text-sm text-zinc-600">{copy.sub}</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter atlas-web test HealthLightsAma`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/run/_components/HealthLightsAma.tsx apps/atlas-web/test/components/HealthLightsAma.test.tsx
git commit -m "feat(atlas-web): HealthLightsAma — Ama-persona traffic-light view"
```

---

### Task 13: Diego persona view — `EndpointTableDiego` component

**Files:**
- Create: `apps/atlas-web/app/projects/[projectId]/run/_components/EndpointTableDiego.tsx`
- Test: `apps/atlas-web/test/components/EndpointTableDiego.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EndpointTableDiego } from "@/app/projects/[projectId]/run/_components/EndpointTableDiego.js";

const stats = [
  { endpointId: "GET /a", requestCount: 1000, errorCount: 3, p50Ms: 80, p95Ms: 400, p99Ms: 800 },
  { endpointId: "POST /b", requestCount: 50, errorCount: 0, p50Ms: 20, p95Ms: 60, p99Ms: 100 }
];

describe("EndpointTableDiego", () => {
  it("renders one row per endpoint with the expected columns", () => {
    render(<EndpointTableDiego stats={stats} />);
    expect(screen.getByText("GET /a")).toBeInTheDocument();
    expect(screen.getByText("POST /b")).toBeInTheDocument();
    expect(screen.getByText("400ms")).toBeInTheDocument(); // p95 of GET /a
  });

  it("renders an empty state when no endpoints", () => {
    render(<EndpointTableDiego stats={[]} />);
    expect(screen.getByText(/no endpoint traffic/i)).toBeInTheDocument();
  });

  it("highlights rows with error rate >= 1%", () => {
    render(<EndpointTableDiego stats={stats} />);
    // GET /a: 3/1000 = 0.3% — not highlighted
    const aRow = screen.getByText("GET /a").closest("tr");
    expect(aRow?.dataset.highlight).not.toBe("true");
    // Add a hot row.
    const hot = [{ endpointId: "GET /h", requestCount: 100, errorCount: 5, p50Ms: 1, p95Ms: 1, p99Ms: 1 }];
    render(<EndpointTableDiego stats={hot} />);
    const hotRow = screen.getByText("GET /h").closest("tr");
    expect(hotRow?.dataset.highlight).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter atlas-web test EndpointTableDiego`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```tsx
import type { EndpointStat } from "@atlas/run-dashboard";

export function EndpointTableDiego({ stats }: { stats: EndpointStat[] }) {
  if (stats.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No endpoint traffic in this window.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-2 text-left">Endpoint</th>
            <th className="px-4 py-2 text-right">Requests</th>
            <th className="px-4 py-2 text-right">Errors</th>
            <th className="px-4 py-2 text-right">p50</th>
            <th className="px-4 py-2 text-right">p95</th>
            <th className="px-4 py-2 text-right">p99</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {stats.map((s) => {
            const errorRate = s.requestCount > 0 ? s.errorCount / s.requestCount : 0;
            const highlight = errorRate >= 0.01;
            return (
              <tr key={s.endpointId} data-highlight={highlight ? "true" : "false"} className={highlight ? "bg-red-50" : ""}>
                <td className="px-4 py-2 font-mono">{s.endpointId}</td>
                <td className="px-4 py-2 text-right">{s.requestCount}</td>
                <td className="px-4 py-2 text-right">{s.errorCount}</td>
                <td className="px-4 py-2 text-right">{s.p50Ms}ms</td>
                <td className="px-4 py-2 text-right">{s.p95Ms}ms</td>
                <td className="px-4 py-2 text-right">{s.p99Ms}ms</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter atlas-web test EndpointTableDiego`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/run/_components/EndpointTableDiego.tsx apps/atlas-web/test/components/EndpointTableDiego.test.tsx
git commit -m "feat(atlas-web): EndpointTableDiego — Diego-persona per-endpoint table"
```

---

### Task 14: Priya persona view — `TraceExplorerPriya` component (table-of-traces only; full trace UI deferred)

**Files:**
- Create: `apps/atlas-web/app/projects/[projectId]/run/_components/TraceExplorerPriya.tsx`
- Test: `apps/atlas-web/test/components/TraceExplorerPriya.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TraceExplorerPriya } from "@/app/projects/[projectId]/run/_components/TraceExplorerPriya.js";

const traces = [
  {
    traceId: "0".repeat(32),
    rootEndpoint: "GET /api/users",
    durationMs: 320,
    errorOccurred: false,
    startedAtIso: "2026-04-22T00:00:00.000Z"
  },
  {
    traceId: "1".repeat(32),
    rootEndpoint: "POST /api/orders",
    durationMs: 1200,
    errorOccurred: true,
    startedAtIso: "2026-04-22T00:01:00.000Z"
  }
];

describe("TraceExplorerPriya", () => {
  it("renders a row per trace with deep-link to the configured backend", () => {
    render(<TraceExplorerPriya traces={traces} grafanaTraceUrlBase="https://grafana.atlas.app/explore?orgId=1&traceId=" />);
    const link = screen.getByText("GET /api/users").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "https://grafana.atlas.app/explore?orgId=1&traceId=" + "0".repeat(32)
    );
  });

  it("marks errored traces with data-errored=true", () => {
    render(<TraceExplorerPriya traces={traces} grafanaTraceUrlBase="https://x" />);
    const row = screen.getByText("POST /api/orders").closest("tr");
    expect(row?.dataset.errored).toBe("true");
  });

  it("renders an empty state when no traces", () => {
    render(<TraceExplorerPriya traces={[]} grafanaTraceUrlBase="https://x" />);
    expect(screen.getByText(/no traces/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter atlas-web test TraceExplorerPriya`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```tsx
import type { TraceLink } from "@atlas/run-dashboard";

export interface TraceExplorerPriyaProps {
  traces: TraceLink[];
  grafanaTraceUrlBase: string;
}

export function TraceExplorerPriya({ traces, grafanaTraceUrlBase }: TraceExplorerPriyaProps) {
  if (traces.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No traces in this window.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-2 text-left">Started</th>
            <th className="px-4 py-2 text-left">Endpoint</th>
            <th className="px-4 py-2 text-right">Duration</th>
            <th className="px-4 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {traces.map((t) => (
            <tr key={t.traceId} data-errored={t.errorOccurred ? "true" : "false"} className={t.errorOccurred ? "bg-red-50" : ""}>
              <td className="px-4 py-2">{t.startedAtIso}</td>
              <td className="px-4 py-2 font-mono">
                <a
                  href={`${grafanaTraceUrlBase}${t.traceId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 underline"
                >
                  {t.rootEndpoint}
                </a>
              </td>
              <td className="px-4 py-2 text-right">{t.durationMs}ms</td>
              <td className="px-4 py-2">{t.errorOccurred ? "error" : "ok"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter atlas-web test TraceExplorerPriya`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/run/_components/TraceExplorerPriya.tsx apps/atlas-web/test/components/TraceExplorerPriya.test.tsx
git commit -m "feat(atlas-web): TraceExplorerPriya — Priya-persona trace table with Grafana deep-link"
```

---

### Task 15: Run dashboard page assembly + persona routing

**Files:**
- Create: `apps/atlas-web/app/projects/[projectId]/run/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { computeHealthSummary, type HealthSummary, type EndpointStat, type TraceLink } from "@atlas/run-dashboard";

export default async function RunDashboardPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ persona?: "ama" | "diego" | "priya" }>;
}) {
  const { projectId } = await params;
  const { persona = "ama" } = await searchParams;

  // Server-side: instantiate a real GrafanaClient + read PromQL.
  // This module is a placeholder until the real client lands. For now we render
  // an explicit "telemetry not yet wired" notice. This becomes a follow-up
  // (D14) once the platform OTel/Prom stack is deployed via Helm.

  const summary: HealthSummary = {
    light: "unknown",
    availabilityRatio: 0,
    openAlerts: 0,
    windowFromIso: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    windowToIso: new Date().toISOString()
  };
  const endpointStats: EndpointStat[] = [];
  const traces: TraceLink[] = [];

  const { HealthLightsAma } = await import("./_components/HealthLightsAma.js");
  const { EndpointTableDiego } = await import("./_components/EndpointTableDiego.js");
  const { TraceExplorerPriya } = await import("./_components/TraceExplorerPriya.js");

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">
          Run · <span className="font-mono text-base text-zinc-600">{projectId}</span>
        </h1>
        <PersonaSwitcher current={persona} projectId={projectId} />
      </header>
      <section className="space-y-6">
        {persona === "ama" && <HealthLightsAma summary={summary} />}
        {persona === "diego" && (
          <>
            <HealthLightsAma summary={summary} />
            <EndpointTableDiego stats={endpointStats} />
          </>
        )}
        {persona === "priya" && (
          <>
            <HealthLightsAma summary={summary} />
            <EndpointTableDiego stats={endpointStats} />
            <TraceExplorerPriya
              traces={traces}
              grafanaTraceUrlBase={process.env.GRAFANA_TRACE_URL_BASE ?? "https://grafana.atlas.app/explore?orgId=1&traceId="}
            />
          </>
        )}
      </section>
    </main>
  );
}

function PersonaSwitcher({ current, projectId }: { current: string; projectId: string }) {
  return (
    <nav className="mt-2 flex gap-2 text-xs">
      {(["ama", "diego", "priya"] as const).map((p) => (
        <a
          key={p}
          href={`/projects/${projectId}/run?persona=${p}`}
          className={`rounded px-2 py-1 ${current === p ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}
        >
          {p}
        </a>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter atlas-web typecheck`
Expected: clean.

```bash
git add apps/atlas-web/app/projects/[projectId]/run/page.tsx
git commit -m "feat(atlas-web): /projects/<id>/run server component with persona switcher"
```

---

### Task 16: deploy-orchestrator: inject `SENTRY_DSN` into Knative env when GlitchTip configured

**Files:**
- Modify: `packages/deploy-orchestrator/src/manifests/knative-service.ts`
- Modify: `packages/deploy-orchestrator/src/orchestrator.ts`
- Test: `packages/deploy-orchestrator/test/manifests-knative.test.ts` (extend)

- [ ] **Step 1: Extend the existing test file**

Add to `packages/deploy-orchestrator/test/manifests-knative.test.ts`:
```ts
describe("emitKnativeServiceManifest — GlitchTip injection", () => {
  it("injects SENTRY_DSN when glitchTipDsn is provided in opts", () => {
    const manifest = emitKnativeServiceManifest(baseReq, {
      branchSchemaName: "br_x",
      glitchTipDsn: "https://abc@glitchtip.atlas.app/1"
    });
    const parsed = yaml.load(manifest) as { spec: { template: { spec: { containers: Array<{ env: Array<{ name: string; value: string }> }> } } } };
    const env = parsed.spec.template.spec.containers[0]!.env;
    expect(env.find((e) => e.name === "SENTRY_DSN")?.value).toBe("https://abc@glitchtip.atlas.app/1");
  });

  it("does not inject SENTRY_DSN when glitchTipDsn absent", () => {
    const manifest = emitKnativeServiceManifest(baseReq, { branchSchemaName: "br_x" });
    expect(manifest).not.toContain("SENTRY_DSN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @atlas/deploy-orchestrator test manifests-knative`
Expected: FAIL on the new test.

- [ ] **Step 3: Update the emitter**

In `knative-service.ts`:
```ts
export interface EmitOptions {
  branchSchemaName: string;
  glitchTipDsn?: string;
}

// inside emitKnativeServiceManifest, after the existing env array:
if (opts.glitchTipDsn) env.push({ name: "SENTRY_DSN", value: opts.glitchTipDsn });
```

In `orchestrator.ts`, accept and forward the DSN:
```ts
export interface DeployOrchestratorOptions {
  // ...existing fields
  glitchTipDsnFor?: (projectId: string) => string | undefined;
}

// inside deploy():
const glitchTipDsn = this.opts.glitchTipDsnFor?.(parsed.projectId);
knativeYaml = emitKnativeServiceManifest(parsed, { branchSchemaName: branch.schemaName, glitchTipDsn });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @atlas/deploy-orchestrator test manifests-knative`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/deploy-orchestrator/src/manifests/knative-service.ts packages/deploy-orchestrator/src/orchestrator.ts packages/deploy-orchestrator/test/manifests-knative.test.ts
git commit -m "feat(deploy-orchestrator): inject SENTRY_DSN into Knative env when GlitchTip configured"
```

---

### Task 17: Helm chart additions for the observability stack

**Files:**
- Create: `deploy/atlas-helm/templates/prometheus-helm-release.yaml`
- Create: `deploy/atlas-helm/templates/loki-helm-release.yaml`
- Create: `deploy/atlas-helm/templates/tempo-helm-release.yaml`
- Create: `deploy/atlas-helm/templates/grafana-helm-release.yaml`
- Create: `deploy/atlas-helm/templates/opentelemetry-collector.yaml`
- Create: `deploy/atlas-helm/templates/glitchtip-helm-release.yaml`
- Modify: `deploy/atlas-helm/values.yaml`
- Modify: `deploy/atlas-helm/README.md`

- [ ] **Step 1: Write each template**

Each template is an Argo CD `Application` that points at the upstream Helm chart for the corresponding component (kube-prometheus-stack, grafana/loki, grafana/tempo, grafana/grafana, open-telemetry/opentelemetry-collector, glitchtip/glitchtip). Pin the chart version in `values.yaml`.

Example `prometheus-helm-release.yaml`:
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: kube-prometheus-stack
  namespace: argocd
spec:
  project: atlas-platform
  source:
    repoURL: https://prometheus-community.github.io/helm-charts
    chart: kube-prometheus-stack
    targetRevision: {{ .Values.observability.prometheus.chartVersion }}
    helm:
      values: |
        prometheus:
          prometheusSpec:
            retention: 14d
  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: [CreateNamespace=true]
```

Other templates follow the same shape with their chart references.

`opentelemetry-collector.yaml`: a plain Deployment + ConfigMap rather than Helm — a small `opentelemetry-collector-contrib` config that receives OTLP from Atlas services and writes to Prometheus + Loki + Tempo.

Update `values.yaml` to add:
```yaml
observability:
  prometheus:
    chartVersion: "65.0.0"
  loki:
    chartVersion: "6.16.0"
  tempo:
    chartVersion: "1.16.0"
  grafana:
    chartVersion: "8.5.0"
  glitchtip:
    chartVersion: "1.0.0"
```

Update `README.md`: extend the bootstrap order to install observability stack after the cert-manager + Knative + Argo CD prerequisites.

- [ ] **Step 2: Commit**

```bash
git add deploy/atlas-helm/templates/prometheus-helm-release.yaml deploy/atlas-helm/templates/loki-helm-release.yaml deploy/atlas-helm/templates/tempo-helm-release.yaml deploy/atlas-helm/templates/grafana-helm-release.yaml deploy/atlas-helm/templates/opentelemetry-collector.yaml deploy/atlas-helm/templates/glitchtip-helm-release.yaml deploy/atlas-helm/values.yaml deploy/atlas-helm/README.md
git commit -m "feat(deploy-helm): observability stack — Prom + Loki + Tempo + Grafana + OTel collector + GlitchTip"
```

---

### Task 18: Plan index update

**Files:**
- Modify: `docs/superpowers/plans/README.md`

- [ ] **Step 1: Add row to plan index after C-1**

```markdown
| 23 | `2026-04-22-c2-observability-dashboard.md` | **C-2 — Atlas Run Observability Dashboard** | `@atlas/observability` (OTel + Prom + atlas logger) + `@atlas/run-dashboard` (HealthSummary/EndpointStat/TraceLink + computers) + atlas-web persona-tiered Run page (Ama/Diego/Priya) + Helm chart additions for Prom + Loki + Tempo + Grafana + OTel collector + GlitchTip | 18 tasks, TDD | Shipped (merged <SHA>) |
```

- [ ] **Step 2: Mark C-2 as shipped in the Phase C section**

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): mark C-2 shipped (merged <SHA>)"
```

---

## Completion Checklist

- [ ] Task 1: `@atlas/observability` scaffold
- [ ] Task 2: `traceAttributes` + canonical `ATLAS_ATTRS`
- [ ] Task 3: Prometheus registry singleton
- [ ] Task 4: OTel SDK bootstrap (noop + otlp-proto)
- [ ] Task 5: pino+OTel logger + barrel + README
- [ ] Task 6: `@atlas/run-dashboard` scaffold
- [ ] Task 7: PersonaTier / HealthSummary / EndpointStat / TraceLink schemas
- [ ] Task 8: GrafanaClient interface + InMemoryGrafanaClient
- [ ] Task 9: `computeHealthSummary` (green/amber/red/unknown)
- [ ] Task 10: `computeEndpointStats`
- [ ] Task 11: run-dashboard barrel + README
- [ ] Task 12: HealthLightsAma component
- [ ] Task 13: EndpointTableDiego component
- [ ] Task 14: TraceExplorerPriya component
- [ ] Task 15: Run dashboard page assembly + persona switcher
- [ ] Task 16: deploy-orchestrator injects SENTRY_DSN when GlitchTip configured
- [ ] Task 17: Helm chart additions for Prom + Loki + Tempo + Grafana + OTel + GlitchTip
- [ ] Task 18: Plan index update

---

## Handoff

After C-2 ships, two follow-ups become unblocked:

1. **C-3** (SLO + burn-rate) gains a real dashboard surface — wire `computeBurnRate` outputs into the Ama/Diego views.
2. **D-7** (Atlas Migrate Enterprise) gains the dashboard story for the named-engineer playbook (Diego / Priya tiers).

Open follow-ups flagged for later:
- A real `HttpGrafanaClient` over fetch (Task 8 ships in-memory only).
- Adopt `@atlas/observability` from inside the existing role-* packages (currently they use `prom-client` ad-hoc; consolidate to the shared registry).
- Real-time updates on the Run page (currently a server component refresh; a small SSE channel would be a follow-up).
- The TraceExplorerPriya is a deep-link table only — building the inline waterfall view is its own plan.
