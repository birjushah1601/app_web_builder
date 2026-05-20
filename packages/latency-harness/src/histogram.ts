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
