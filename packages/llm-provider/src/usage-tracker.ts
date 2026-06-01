/**
 * Per-provider/per-model pricing in USD per 1M tokens.
 * Public list pricing as of 2026-06-01. Update manually when providers
 * change their pricing tables (we don't fetch this at runtime).
 */
export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "anthropic:claude-opus-4-7":   { inputPerMTok: 15.00, outputPerMTok: 75.00 },
  "anthropic:claude-sonnet-4-6": { inputPerMTok:  3.00, outputPerMTok: 15.00 },
  "anthropic:claude-haiku-4-5":  { inputPerMTok:  1.00, outputPerMTok:  5.00 },
  "google:gemini-2.5-pro":       { inputPerMTok:  1.25, outputPerMTok:  5.00 },
  "google:gemini-2.5-flash":     { inputPerMTok:  0.075, outputPerMTok: 0.30 }
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

const DATE_SUFFIX_RE = /-\d{8}$/;

export function computeUsd(provider: string, model: string, usage: TokenUsage): number {
  const normalizedModel = model.replace(DATE_SUFFIX_RE, "");
  const price = MODEL_PRICING[`${provider}:${normalizedModel}`];
  if (!price) return 0;
  return (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000;
}

export interface LLMUsageTracker {
  record(provider: string, model: string, usage: TokenUsage): void;
  totalUsd(): number;
}

export class InMemoryUsageTracker implements LLMUsageTracker {
  private total = 0;

  record(provider: string, model: string, usage: TokenUsage): void {
    this.total += computeUsd(provider, model, usage);
  }

  totalUsd(): number {
    return this.total;
  }
}
