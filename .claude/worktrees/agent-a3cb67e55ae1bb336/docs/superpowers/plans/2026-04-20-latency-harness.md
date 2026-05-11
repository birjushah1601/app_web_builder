# Latency Harness + Regression Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/latency-harness/` — continuous measurement of ritual round-trip latency bucketed by `EditClass`, with regression alerting on per-tier P50/P95 budgets per PRD §NFR-8 (`<200ms cosmetic p50`). The harness is a sidecar that subscribes to `ritual.started` and `ritual.completed` events, computes wall-clock per ritual, exports Prometheus histograms, and fires structured alerts when a rolling-window P50 / P95 exceeds the configured budget.

**Architecture:** A single new pnpm-workspace package. `LatencyHarness` is a class with three responsibilities: (a) **Sampler** — subscribe to `EventSink` events, compute `ritual.completed.ts - ritual.started.ts` per `ritualId`, label by `editClass`. (b) **Histogram exporter** — emit `atlas_ritual_latency_seconds{tier,outcome}` via `prom-client`, integrating with the existing observability registry from `@atlas/llm-provider`. (c) **Regression alerter** — sliding-window P50/P95 calculator; when budget exceeded N times consecutively, emits a structured alert via injected `AlertSink` (production wires through PagerDuty/Slack/etc.; tests use in-memory). Budgets per tier from PRD §NFR-8 + §9.5: cosmetic P50 200ms / P95 800ms; structural P50 5s / P95 30s; SC-touching P50 8s / P95 60s.

**Tech Stack:** TypeScript 5.6.3 · pnpm workspace · Zod 3.23.8 · Vitest 2.1.8 · Node 22 LTS · `prom-client` 15.x. Workspace deps: `@atlas/edit-classifier`, `@atlas/ritual-engine`, `@atlas/llm-provider` (for the shared metrics registry helper). No new external runtime deps.

**Prerequisites the implementing engineer needs installed before starting:**
- Plans E.1, G.1 merged.
- Node 22 + pnpm 9+.

---

## File Structure

```
packages/
  latency-harness/                            # NEW
    package.json
    tsconfig.json
    vitest.config.ts
    README.md
    src/
      index.ts
      budgets.ts                              # canonical per-tier budgets + BudgetSchema
      sampler.ts                              # subscribes to ritual events, computes durations
      histogram.ts                            # prom-client histograms registration
      window.ts                               # sliding-window P50/P95 calculator
      alerter.ts                              # AlertSink interface + console-default
      harness.ts                              # LatencyHarness — wires everything
    test/
      budgets.test.ts
      sampler.test.ts
      histogram.test.ts
      window.test.ts
      alerter.test.ts
      harness-end-to-end.test.ts

docs/superpowers/plans/
  README.md                                   # MODIFIED — add G.2 entry
```

## Open-question resolutions

- **OQ4 (latency-harness cadence) → continuous in CI + production.** Every ritual is sampled; aggregation is sliding-window over the last `windowSize` rituals (default 100). Alerts fire when N consecutive windows exceed budget (default `consecutiveExceeded: 3`).
- **Which CI step computes the canary number?** The Phase A exit checklist (existing `pnpm -r test`) already runs the test suite. The harness's `windowReport()` method provides a JSON summary that CI scripts can parse and gate on; G.2 ships the API, the CI workflow change is out of scope.

---

## Tasks

### Task 1: Scaffold `packages/latency-harness/`

**Files:** package.json, tsconfig, vitest.config, src/index.ts placeholder.

```json
{
  "name": "@atlas/latency-harness",
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
    "test": "vitest run"
  },
  "dependencies": {
    "@atlas/edit-classifier": "workspace:*",
    "@atlas/ritual-engine": "workspace:*",
    "prom-client": "^15.1.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] Create dirs, write configs, install + verify, commit:
```bash
mkdir -p packages/latency-harness/src packages/latency-harness/test
# (write the files)
pnpm install
pnpm -F @atlas/latency-harness typecheck
git add packages/latency-harness/ pnpm-lock.yaml
git commit -m "feat(latency-harness): scaffold package with edit-classifier + ritual-engine + prom-client"
```

---

### Task 2: `Budget` schema + canonical per-tier budgets

**Files:** `src/budgets.ts` + `test/budgets.test.ts`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { BudgetSchema, BUDGETS, type Budget } from "../src/budgets.js";

describe("budgets", () => {
  it("BUDGETS has entries for all 3 tiers", () => {
    expect(BUDGETS.cosmetic).toBeDefined();
    expect(BUDGETS.structural).toBeDefined();
    expect(BUDGETS["security-compliance-touching"]).toBeDefined();
  });

  it("BUDGETS.cosmetic matches PRD NFR-8 (P50 200ms, P95 800ms)", () => {
    expect(BUDGETS.cosmetic.p50Ms).toBe(200);
    expect(BUDGETS.cosmetic.p95Ms).toBe(800);
  });

  it("BUDGETS.structural P50 ≤ structural P95 ≤ SC-touching P95", () => {
    expect(BUDGETS.structural.p50Ms).toBeLessThanOrEqual(BUDGETS.structural.p95Ms);
    expect(BUDGETS.structural.p95Ms).toBeLessThanOrEqual(BUDGETS["security-compliance-touching"].p95Ms);
  });

  it("BudgetSchema parses a custom budget", () => {
    const b: Budget = { p50Ms: 100, p95Ms: 500 };
    expect(BudgetSchema.parse(b)).toEqual(b);
  });

  it("BudgetSchema rejects p95 < p50", () => {
    expect(() => BudgetSchema.parse({ p50Ms: 500, p95Ms: 100 })).toThrow();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { z } from "zod";
import type { EditClass } from "@atlas/edit-classifier";

export const BudgetSchema = z.object({
  p50Ms: z.number().int().positive(),
  p95Ms: z.number().int().positive()
}).superRefine((b, ctx) => {
  if (b.p95Ms < b.p50Ms) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "p95Ms must be >= p50Ms", path: ["p95Ms"] });
  }
});
export type Budget = z.infer<typeof BudgetSchema>;

export const BUDGETS: Record<EditClass, Budget> = {
  "cosmetic": { p50Ms: 200, p95Ms: 800 },
  "structural": { p50Ms: 5_000, p95Ms: 30_000 },
  "security-compliance-touching": { p50Ms: 8_000, p95Ms: 60_000 }
};
```

- [ ] **Step 3: Commit**
```bash
git add packages/latency-harness/src/budgets.ts packages/latency-harness/test/budgets.test.ts
git commit -m "feat(latency-harness): per-tier budgets (PRD NFR-8) + Budget Zod"
```

---

### Task 3: `Sampler` — subscribes to ritual events and computes durations

**Files:** `src/sampler.ts` + `test/sampler.test.ts`.

The sampler maintains a `Map<ritualId, { startedAt, editClass }>`. On `ritual.completed`, it computes elapsed-ms and emits a `LatencySample` to its listener.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { Sampler, type LatencySample } from "../src/sampler.js";
import type { RitualEvent } from "@atlas/ritual-engine";

describe("Sampler", () => {
  it("computes elapsed-ms between started and completed for the same ritualId", async () => {
    const samples: LatencySample[] = [];
    const sampler = new Sampler({ onSample: async (s) => { samples.push(s); } });

    const started: RitualEvent = {
      type: "ritual.started", ritualId: "r-1", ts: "2026-04-20T00:00:00.000Z",
      payload: { intent: "x", editClass: "cosmetic", projectId: "p", userId: "u" }
    };
    const completed: RitualEvent = {
      type: "ritual.completed", ritualId: "r-1", ts: "2026-04-20T00:00:00.150Z",
      payload: { finalState: "done" }
    };
    await sampler.onEvent(started);
    await sampler.onEvent(completed);

    expect(samples).toHaveLength(1);
    expect(samples[0].ritualId).toBe("r-1");
    expect(samples[0].editClass).toBe("cosmetic");
    expect(samples[0].outcome).toBe("done");
    expect(samples[0].elapsedMs).toBe(150);
  });

  it("ignores completed without preceding started", async () => {
    const samples: LatencySample[] = [];
    const sampler = new Sampler({ onSample: async (s) => { samples.push(s); } });
    await sampler.onEvent({
      type: "ritual.completed", ritualId: "ghost", ts: "t",
      payload: { finalState: "done" }
    });
    expect(samples).toEqual([]);
  });

  it("releases the started entry after completion (no leak)", async () => {
    const samples: LatencySample[] = [];
    const sampler = new Sampler({ onSample: async (s) => { samples.push(s); } });
    await sampler.onEvent({
      type: "ritual.started", ritualId: "r", ts: "2026-04-20T00:00:00.000Z",
      payload: { intent: "x", editClass: "cosmetic", projectId: "p", userId: "u" }
    });
    await sampler.onEvent({
      type: "ritual.completed", ritualId: "r", ts: "2026-04-20T00:00:00.100Z",
      payload: { finalState: "done" }
    });
    expect(sampler.activeRituals()).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { RitualEvent } from "@atlas/ritual-engine";
import type { EditClass } from "@atlas/edit-classifier";

export interface LatencySample {
  ritualId: string;
  editClass: EditClass;
  outcome: "done" | "escalated" | "aborted";
  startedAtMs: number;
  completedAtMs: number;
  elapsedMs: number;
}

export interface SamplerOptions {
  onSample(sample: LatencySample): Promise<void>;
}

export class Sampler {
  private inflight = new Map<string, { startedAtMs: number; editClass: EditClass }>();
  private readonly onSample: (s: LatencySample) => Promise<void>;
  constructor(opts: SamplerOptions) { this.onSample = opts.onSample; }

  async onEvent(event: RitualEvent): Promise<void> {
    if (event.type === "ritual.started") {
      this.inflight.set(event.ritualId, {
        startedAtMs: Date.parse(event.ts),
        editClass: event.payload.editClass
      });
      return;
    }
    if (event.type === "ritual.completed") {
      const start = this.inflight.get(event.ritualId);
      if (!start) return;
      this.inflight.delete(event.ritualId);
      const completedAtMs = Date.parse(event.ts);
      await this.onSample({
        ritualId: event.ritualId,
        editClass: start.editClass,
        outcome: event.payload.finalState,
        startedAtMs: start.startedAtMs,
        completedAtMs,
        elapsedMs: completedAtMs - start.startedAtMs
      });
    }
  }

  activeRituals(): number {
    return this.inflight.size;
  }
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/latency-harness test sampler
git add packages/latency-harness/src/sampler.ts packages/latency-harness/test/sampler.test.ts
git commit -m "feat(latency-harness): Sampler computes elapsed-ms per ritualId across started/completed"
```

---

### Task 4: Histogram registration + observation

**Files:** `src/histogram.ts` + `test/histogram.test.ts`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { Registry } from "prom-client";
import { createLatencyHistograms, observeSample } from "../src/histogram.js";

describe("histogram", () => {
  it("createLatencyHistograms registers a single histogram with correct labels", () => {
    const registry = new Registry();
    const h = createLatencyHistograms(registry);
    expect(h.ritualLatencySeconds).toBeDefined();
  });

  it("observeSample increments the right bucket per tier+outcome", async () => {
    const registry = new Registry();
    const h = createLatencyHistograms(registry);
    observeSample(h, {
      ritualId: "r", editClass: "cosmetic", outcome: "done",
      startedAtMs: 0, completedAtMs: 250, elapsedMs: 250
    });
    const raw = await registry.getMetricsAsJSON();
    const m = raw.find((x) => x.name === "atlas_ritual_latency_seconds");
    expect(m).toBeDefined();
    const cosmeticDone = (m as unknown as { values: Array<{ labels: Record<string, string>; value: number }> }).values
      .filter((v) => v.labels.tier === "cosmetic" && v.labels.outcome === "done");
    expect(cosmeticDone.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import { Histogram, Registry } from "prom-client";
import type { LatencySample } from "./sampler.js";

export interface LatencyHistograms {
  ritualLatencySeconds: Histogram<string>;
}

export function createLatencyHistograms(registry: Registry): LatencyHistograms {
  const h = new Histogram({
    name: "atlas_ritual_latency_seconds",
    help: "End-to-end ritual latency by edit-class tier and outcome",
    labelNames: ["tier", "outcome"],
    buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry]
  });
  return { ritualLatencySeconds: h };
}

export function observeSample(h: LatencyHistograms, sample: LatencySample): void {
  const seconds = sample.elapsedMs / 1000;
  h.ritualLatencySeconds
    .labels({ tier: sample.editClass, outcome: sample.outcome })
    .observe(seconds);
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/latency-harness test histogram
git add packages/latency-harness/src/histogram.ts packages/latency-harness/test/histogram.test.ts
git commit -m "feat(latency-harness): Prometheus histogram atlas_ritual_latency_seconds {tier,outcome}"
```

---

### Task 5: Sliding-window P50/P95 calculator

**Files:** `src/window.ts` + `test/window.test.ts`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { SlidingWindow } from "../src/window.js";

describe("SlidingWindow", () => {
  it("p50 + p95 of [100..1000] (100 samples) approximate 500 + 950 ms", () => {
    const w = new SlidingWindow(1000);
    for (let i = 1; i <= 100; i++) w.push(i * 10);
    expect(w.p50()).toBeGreaterThan(495);
    expect(w.p50()).toBeLessThan(515);
    expect(w.p95()).toBeGreaterThan(940);
    expect(w.p95()).toBeLessThan(960);
  });

  it("evicts oldest when window full", () => {
    const w = new SlidingWindow(3);
    w.push(100); w.push(200); w.push(300); w.push(400);
    expect(w.size()).toBe(3);
    expect(w.p50()).toBe(300); // [200, 300, 400]
  });

  it("size + reset behaviors", () => {
    const w = new SlidingWindow(10);
    w.push(1); w.push(2); w.push(3);
    expect(w.size()).toBe(3);
    w.reset();
    expect(w.size()).toBe(0);
  });

  it("p50/p95 throw on empty window", () => {
    const w = new SlidingWindow(10);
    expect(() => w.p50()).toThrow();
    expect(() => w.p95()).toThrow();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
export class SlidingWindow {
  private values: number[] = [];
  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new Error("capacity must be positive");
  }
  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.capacity) this.values.shift();
  }
  size(): number { return this.values.length; }
  reset(): void { this.values = []; }
  p50(): number { return this.percentile(0.50); }
  p95(): number { return this.percentile(0.95); }
  private percentile(p: number): number {
    if (this.values.length === 0) throw new Error("window empty");
    const sorted = [...this.values].sort((a, b) => a - b);
    const idx = Math.floor(p * (sorted.length - 1));
    return sorted[idx];
  }
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/latency-harness test window
git add packages/latency-harness/src/window.ts packages/latency-harness/test/window.test.ts
git commit -m "feat(latency-harness): SlidingWindow with O(n log n) p50/p95 percentile calc"
```

---

### Task 6: `Alerter` — fires alerts when budget exceeded for N consecutive windows

**Files:** `src/alerter.ts` + `test/alerter.test.ts`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { BudgetAlerter, type LatencyAlert } from "../src/alerter.js";
import { BUDGETS } from "../src/budgets.js";

describe("BudgetAlerter", () => {
  it("fires after N consecutive windows over budget", async () => {
    const alerts: LatencyAlert[] = [];
    const alerter = new BudgetAlerter({
      budgets: BUDGETS,
      consecutiveExceeded: 3,
      sink: { emit: async (a) => { alerts.push(a); } }
    });

    // Cosmetic budget p50=200ms. Window of 250ms p50 → exceeded.
    for (let i = 0; i < 3; i++) {
      await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 250, windowP95Ms: 1500, sampleCount: 100 });
    }

    expect(alerts).toHaveLength(1);
    expect(alerts[0].tier).toBe("cosmetic");
    expect(alerts[0].metric).toBe("p50");
    expect(alerts[0].observedMs).toBe(250);
    expect(alerts[0].budgetMs).toBe(200);
  });

  it("does not fire under threshold", async () => {
    const alerts: LatencyAlert[] = [];
    const alerter = new BudgetAlerter({ budgets: BUDGETS, consecutiveExceeded: 3, sink: { emit: async (a) => { alerts.push(a); } } });
    for (let i = 0; i < 10; i++) {
      await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 150, windowP95Ms: 700, sampleCount: 100 });
    }
    expect(alerts).toHaveLength(0);
  });

  it("resets consecutive count when a healthy window arrives", async () => {
    const alerts: LatencyAlert[] = [];
    const alerter = new BudgetAlerter({ budgets: BUDGETS, consecutiveExceeded: 3, sink: { emit: async (a) => { alerts.push(a); } } });
    await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 250, windowP95Ms: 700, sampleCount: 100 });
    await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 250, windowP95Ms: 700, sampleCount: 100 });
    await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 150, windowP95Ms: 700, sampleCount: 100 }); // healthy → reset
    await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 250, windowP95Ms: 700, sampleCount: 100 });
    expect(alerts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { EditClass } from "@atlas/edit-classifier";
import type { Budget } from "./budgets.js";

export interface WindowReport {
  tier: EditClass;
  windowP50Ms: number;
  windowP95Ms: number;
  sampleCount: number;
}

export interface LatencyAlert {
  tier: EditClass;
  metric: "p50" | "p95";
  observedMs: number;
  budgetMs: number;
  consecutiveWindows: number;
  ts: string;
}

export interface AlertSink {
  emit(alert: LatencyAlert): Promise<void>;
}

export interface BudgetAlerterOptions {
  budgets: Record<EditClass, Budget>;
  consecutiveExceeded: number;
  sink: AlertSink;
}

export class BudgetAlerter {
  private streaks = new Map<string, number>();
  private fired = new Map<string, boolean>();
  private readonly opts: BudgetAlerterOptions;
  constructor(opts: BudgetAlerterOptions) { this.opts = opts; }

  async evaluate(report: WindowReport): Promise<void> {
    const budget = this.opts.budgets[report.tier];
    for (const metric of ["p50", "p95"] as const) {
      const observed = metric === "p50" ? report.windowP50Ms : report.windowP95Ms;
      const budgetMs = metric === "p50" ? budget.p50Ms : budget.p95Ms;
      const key = `${report.tier}:${metric}`;
      if (observed > budgetMs) {
        const next = (this.streaks.get(key) ?? 0) + 1;
        this.streaks.set(key, next);
        if (next >= this.opts.consecutiveExceeded && !this.fired.get(key)) {
          this.fired.set(key, true);
          await this.opts.sink.emit({
            tier: report.tier, metric, observedMs: observed, budgetMs,
            consecutiveWindows: next, ts: new Date().toISOString()
          });
        }
      } else {
        this.streaks.set(key, 0);
        this.fired.set(key, false);
      }
    }
  }
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/latency-harness test alerter
git add packages/latency-harness/src/alerter.ts packages/latency-harness/test/alerter.test.ts
git commit -m "feat(latency-harness): BudgetAlerter — fires after N consecutive over-budget windows"
```

---

### Task 7: `LatencyHarness` — end-to-end wiring

**Files:** `src/harness.ts` + `test/harness-end-to-end.test.ts`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { LatencyHarness } from "../src/harness.js";
import { BUDGETS } from "../src/budgets.js";
import type { RitualEvent } from "@atlas/ritual-engine";

describe("LatencyHarness end-to-end", () => {
  it("samples → histogram + sliding window + alert when budget violated", async () => {
    const registry = new Registry();
    const alerts: unknown[] = [];
    const h = new LatencyHarness({
      registry,
      budgets: BUDGETS,
      windowSize: 5,
      consecutiveExceeded: 2,
      alertSink: { emit: async (a) => { alerts.push(a); } }
    });

    // Push 7 cosmetic rituals all 300ms (exceeds cosmetic p50 budget 200ms)
    for (let i = 0; i < 7; i++) {
      const id = `r-${i}`;
      const t0 = `2026-04-20T00:00:0${i}.000Z`;
      const t1 = `2026-04-20T00:00:0${i}.300Z`;
      await h.onEvent({ type: "ritual.started", ritualId: id, ts: t0,
        payload: { intent: "x", editClass: "cosmetic", projectId: "p", userId: "u" } });
      await h.onEvent({ type: "ritual.completed", ritualId: id, ts: t1, payload: { finalState: "done" } });
    }

    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const a = alerts[0] as { tier: string; metric: string };
    expect(a.tier).toBe("cosmetic");
    expect(a.metric).toBe("p50");

    const metrics = await registry.getMetricsAsJSON();
    const lat = metrics.find((m) => m.name === "atlas_ritual_latency_seconds");
    expect(lat).toBeDefined();
  });

  it("windowReport returns per-tier P50/P95 snapshot", async () => {
    const registry = new Registry();
    const h = new LatencyHarness({
      registry, budgets: BUDGETS, windowSize: 100, consecutiveExceeded: 3,
      alertSink: { emit: async () => {} }
    });
    for (let i = 0; i < 10; i++) {
      const id = `r-${i}`;
      const t0 = `2026-04-20T00:00:00.000Z`;
      const t1 = `2026-04-20T00:00:00.${100 + i * 10}Z`;
      await h.onEvent({ type: "ritual.started", ritualId: id, ts: t0,
        payload: { intent: "x", editClass: "cosmetic", projectId: "p", userId: "u" } });
      await h.onEvent({ type: "ritual.completed", ritualId: id, ts: t1, payload: { finalState: "done" } });
    }
    const report = h.windowReport();
    expect(report.cosmetic).toBeDefined();
    expect(report.cosmetic!.sampleCount).toBe(10);
    expect(report.cosmetic!.windowP50Ms).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { Registry } from "prom-client";
import type { RitualEvent } from "@atlas/ritual-engine";
import type { EditClass } from "@atlas/edit-classifier";
import { Sampler, type LatencySample } from "./sampler.js";
import { createLatencyHistograms, observeSample, type LatencyHistograms } from "./histogram.js";
import { SlidingWindow } from "./window.js";
import { BudgetAlerter, type AlertSink, type WindowReport } from "./alerter.js";
import type { Budget } from "./budgets.js";

export interface LatencyHarnessOptions {
  registry: Registry;
  budgets: Record<EditClass, Budget>;
  windowSize: number;
  consecutiveExceeded: number;
  alertSink: AlertSink;
}

export class LatencyHarness {
  private readonly sampler: Sampler;
  private readonly histograms: LatencyHistograms;
  private readonly windows: Record<EditClass, SlidingWindow>;
  private readonly alerter: BudgetAlerter;

  constructor(opts: LatencyHarnessOptions) {
    this.histograms = createLatencyHistograms(opts.registry);
    this.windows = {
      "cosmetic": new SlidingWindow(opts.windowSize),
      "structural": new SlidingWindow(opts.windowSize),
      "security-compliance-touching": new SlidingWindow(opts.windowSize)
    };
    this.alerter = new BudgetAlerter({
      budgets: opts.budgets,
      consecutiveExceeded: opts.consecutiveExceeded,
      sink: opts.alertSink
    });
    this.sampler = new Sampler({
      onSample: async (sample) => {
        observeSample(this.histograms, sample);
        const w = this.windows[sample.editClass];
        w.push(sample.elapsedMs);
        if (w.size() >= 1) {
          await this.alerter.evaluate({
            tier: sample.editClass,
            windowP50Ms: w.p50(),
            windowP95Ms: w.p95(),
            sampleCount: w.size()
          });
        }
      }
    });
  }

  async onEvent(event: RitualEvent): Promise<void> {
    await this.sampler.onEvent(event);
  }

  windowReport(): Partial<Record<EditClass, WindowReport>> {
    const out: Partial<Record<EditClass, WindowReport>> = {};
    for (const tier of ["cosmetic", "structural", "security-compliance-touching"] as const) {
      const w = this.windows[tier];
      if (w.size() > 0) {
        out[tier] = { tier, windowP50Ms: w.p50(), windowP95Ms: w.p95(), sampleCount: w.size() };
      }
    }
    return out;
  }
}
```

- [ ] **Step 3: Commit**
```bash
pnpm -F @atlas/latency-harness test harness-end-to-end
git add packages/latency-harness/src/harness.ts packages/latency-harness/test/harness-end-to-end.test.ts
git commit -m "feat(latency-harness): LatencyHarness wires sampler + histogram + window + alerter"
```

---

### Task 8: Public `src/index.ts`

```typescript
export * from "./budgets.js";
export * from "./sampler.js";
export * from "./histogram.js";
export * from "./window.js";
export * from "./alerter.js";
export * from "./harness.js";
```

Add public-API smoke test asserting `LatencyHarness`, `BUDGETS`, `Sampler`, `SlidingWindow`, `BudgetAlerter`, `createLatencyHistograms`. Commit.

```bash
git add packages/latency-harness/src/index.ts packages/latency-harness/test/public-api.test.ts
git commit -m "feat(latency-harness): public API barrel"
```

---

### Task 9: Build + workspace smoke

```bash
pnpm -F @atlas/latency-harness build
pnpm -F @atlas/latency-harness typecheck
pnpm -F @atlas/latency-harness test
pnpm -r test
git commit --allow-empty -m "chore(latency-harness): full-suite smoke green"
```

---

### Task 10: Package README

````markdown
# @atlas/latency-harness

Continuous measurement of ritual round-trip latency, bucketed by edit-class tier (cosmetic / structural / security-compliance-touching). Subscribes to the ritual `EventSink` from `@atlas/ritual-engine`, computes wall-clock per ritual, exports Prometheus histograms, and fires alerts when sliding-window P50/P95 violates the budgets in PRD §NFR-8.

## Per-tier budgets

| Tier | P50 | P95 |
|---|---|---|
| cosmetic | 200ms | 800ms |
| structural | 5s | 30s |
| security-compliance-touching | 8s | 60s |

## Usage

```ts
import { Registry } from "prom-client";
import { LatencyHarness, BUDGETS } from "@atlas/latency-harness";
import { RitualEngine, InMemoryEventSink } from "@atlas/ritual-engine";

const registry = new Registry();
const harness = new LatencyHarness({
  registry,
  budgets: BUDGETS,
  windowSize: 100,
  consecutiveExceeded: 3,
  alertSink: { emit: async (alert) => pagerDuty.notify(alert) }
});

// Wire the engine's event sink to forward to the harness
const sink = {
  async emit(event) {
    await ritualEngineSink.emit(event);
    await harness.onEvent(event);
  }
};

// Periodic snapshot for CI gating:
console.log(harness.windowReport());
```

## Alert payload

```ts
{
  tier: "cosmetic",
  metric: "p50",
  observedMs: 250,
  budgetMs: 200,
  consecutiveWindows: 3,
  ts: "2026-04-20T00:00:00.000Z"
}
```

Once an alert fires, it does not re-fire until a healthy window resets the streak.
````

```bash
git add packages/latency-harness/README.md
git commit -m "docs(latency-harness): README — budgets, usage, alert payload"
```

---

### Task 11: Plan index update

Insert G.2 row in the Plan index after G.1:

```
| 14 | `2026-04-20-latency-harness.md` | **G.2 — Latency Harness + Regression Alerting** | Per-tier P50/P95 sliding-window measurement; Prometheus histogram export; budget alerts on N consecutive over-budget windows | 11 tasks, TDD | Shipped (pending merge — TODO: update SHA post-merge) |
```

Renumber subsequent rows (directional docs +1). Refresh execution-order diagram so G.2 appears under G.1.

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add G.2 latency-harness to plan index"
```

---

## Completion Checklist

- [ ] `pnpm -F @atlas/latency-harness test` green (~16 tests across 6 files)
- [ ] `LatencyHarness.onEvent` correctly pairs started/completed by ritualId
- [ ] Histogram exports `atlas_ritual_latency_seconds{tier,outcome}`
- [ ] BudgetAlerter fires after N consecutive over-budget windows; resets on healthy window
- [ ] `windowReport()` returns per-tier P50/P95 snapshot for CI gating
- [ ] Plan index lists G.2 as shipped (pending merge)

## Handoff to E.2 + ops

- **E.2** (Atlas Web): instantiates a `LatencyHarness` server-side and exposes the histogram via `/metrics` for Prometheus scraping.
- **Ops / on-call**: configures `AlertSink` to integrate with PagerDuty / Slack / OpsGenie; PagerDuty-style alert priority maps from `metric: "p95" → "high"`, `metric: "p50" → "medium"`.
- **Phase A exit checklist**: includes "cosmetic p50 < 200ms" — measured by `windowReport().cosmetic.windowP50Ms` over the canonical 1,000-prompt eval suite.
