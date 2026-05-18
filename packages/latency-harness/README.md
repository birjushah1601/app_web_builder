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
