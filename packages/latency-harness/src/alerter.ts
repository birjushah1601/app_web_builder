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
          return; // fire at most one alert per evaluate call
        }
      } else {
        this.streaks.set(key, 0);
        this.fired.set(key, false);
      }
    }
  }
}
