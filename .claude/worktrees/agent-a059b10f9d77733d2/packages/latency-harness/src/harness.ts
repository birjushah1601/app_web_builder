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
