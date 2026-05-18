import { z } from "zod";
import { SpendCapExceededError } from "./errors.js";

export const SpendCapConfigSchema = z.object({
  capUsd: z.number().positive(),
  /** Multiplier over rolling average that triggers a warning alarm (default 3). */
  warnMultiplier: z.number().min(1).default(3),
});
export type SpendCapConfig = z.infer<typeof SpendCapConfigSchema>;

export interface SpendReader {
  /** Returns USD accumulated for this project in the current billing month. */
  getAccumulatedSpend(projectId: string): Promise<number>;
  /** Returns 30-day rolling average monthly spend for this project. 0 for new projects. */
  getRollingAverageSpend(projectId: string): Promise<number>;
}

/**
 * Checks whether provisioning a new sandbox would breach the project spend cap.
 * Throws {@link SpendCapExceededError} if accumulated spend >= cap.
 * Emits a console.warn alarm if accumulated >= warnMultiplier × rollingAverage.
 */
export async function checkSpendCap(
  projectId: string,
  reader: SpendReader,
  config: SpendCapConfig
): Promise<void> {
  const [accumulated, rollingAverage] = await Promise.all([
    reader.getAccumulatedSpend(projectId),
    reader.getRollingAverageSpend(projectId),
  ]);

  if (accumulated >= config.capUsd) {
    throw new SpendCapExceededError(projectId, config.capUsd, accumulated);
  }

  const threshold = rollingAverage * config.warnMultiplier;
  if (rollingAverage > 0 && accumulated >= threshold) {
    console.warn(
      `[sandbox-e2b] spend alarm: project ${projectId} has accumulated $${accumulated.toFixed(2)}, ` +
        `which is ${config.warnMultiplier}× the rolling average ($${rollingAverage.toFixed(2)}). ` +
        `Cap is $${config.capUsd.toFixed(2)}.`
    );
  }
}
