import type { SloDefinition, SloSample } from "./types.js";

export interface BurnRateReport {
  sloId: string;
  /** Achieved goodness across the window: goodCount / totalCount. */
  achievedRatio: number;
  /** Error budget consumed as a fraction in [0, 1]. 1.0 = budget exhausted. */
  errorBudgetConsumed: number;
  /** Burn rate vs target: 1.0 = on target; > 1 = burning faster than budget allows. */
  burnRate: number;
  /** Number of samples that contributed. */
  sampleCount: number;
  /** True when burn rate ≥ severity threshold (defaults to 14× per Google SRE workbook). */
  alarming: boolean;
}

export interface BurnRateOptions {
  /** Threshold above which `alarming` flips true. Default 14× (1-hour budget exhausted in 5 days). */
  alarmingThreshold?: number;
}

/**
 * Compute the burn-rate report from a stream of slice samples.
 * Samples must all reference the same sloId; otherwise throws.
 */
export function computeBurnRate(
  slo: SloDefinition,
  samples: SloSample[],
  options: BurnRateOptions = {}
): BurnRateReport {
  const alarmThreshold = options.alarmingThreshold ?? 14;
  if (samples.length === 0) {
    return {
      sloId: slo.id,
      achievedRatio: 1,
      errorBudgetConsumed: 0,
      burnRate: 0,
      sampleCount: 0,
      alarming: false
    };
  }
  for (const s of samples) {
    if (s.sloId !== slo.id) {
      throw new Error(`computeBurnRate: sample sloId "${s.sloId}" does not match slo.id "${slo.id}"`);
    }
  }
  let totalCount = 0;
  let goodCount = 0;
  for (const s of samples) {
    totalCount += s.totalCount;
    goodCount += s.goodCount;
  }
  if (totalCount === 0) {
    return {
      sloId: slo.id,
      achievedRatio: 1,
      errorBudgetConsumed: 0,
      burnRate: 0,
      sampleCount: samples.length,
      alarming: false
    };
  }
  const achievedRatio = goodCount / totalCount;
  const errorBudget = 1 - slo.target;
  const errorRate = 1 - achievedRatio;
  const errorBudgetConsumed = errorBudget === 0 ? (errorRate > 0 ? 1 : 0) : Math.min(1, errorRate / errorBudget);
  const burnRate = errorBudget === 0 ? (errorRate > 0 ? Infinity : 0) : errorRate / errorBudget;
  return {
    sloId: slo.id,
    achievedRatio,
    errorBudgetConsumed,
    burnRate,
    sampleCount: samples.length,
    alarming: burnRate >= alarmThreshold
  };
}
