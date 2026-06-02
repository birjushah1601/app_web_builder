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

/**
 * Plan G.3 — synthetic roleId for records made without one. Lets the
 * breakdown shape stay uniform without forcing every existing call site
 * to know about roles. Role-aware call sites will pass a real roleId in
 * a follow-up plan.
 */
export const UNASSIGNED_ROLE_ID = "__unassigned__";

/**
 * Plan G.3 — per-role cost breakdown entry. roleId is either a real role
 * identifier (e.g. "developer", "tester") or the synthetic
 * `__unassigned__` bucket for records made without one.
 */
export interface UsageBreakdownEntry {
  roleId: string;
  totalUsd: number;
  callCount: number;
}

export interface LLMUsageTracker {
  /**
   * Plan G.3 — `opts.roleId` buckets the cost under a per-role total
   * surfaced via `breakdown()`. Records made without a roleId fall
   * under the synthetic `__unassigned__` bucket. The overall
   * `totalUsd()` continues to return the cross-role sum.
   */
  record(
    provider: string,
    model: string,
    usage: TokenUsage,
    opts?: { roleId?: string }
  ): void;
  totalUsd(): number;
  /**
   * Plan G.3 — returns per-role spend sorted by totalUsd descending so
   * the UI can render a "biggest spender first" list. Empty tracker
   * returns []. callCount counts records (NOT tokens), including
   * zero-cost records for unknown models so we can still see the
   * activity volume.
   */
  breakdown(): UsageBreakdownEntry[];
}

export class InMemoryUsageTracker implements LLMUsageTracker {
  private total = 0;
  /**
   * Plan G.3 — Map<roleId, {totalUsd, callCount}>. Insertion order is
   * irrelevant; `breakdown()` sorts by totalUsd desc on read.
   */
  private readonly byRole = new Map<string, { totalUsd: number; callCount: number }>();

  record(
    provider: string,
    model: string,
    usage: TokenUsage,
    opts?: { roleId?: string }
  ): void {
    const cost = computeUsd(provider, model, usage);
    this.total += cost;

    const roleId = opts?.roleId ?? UNASSIGNED_ROLE_ID;
    const existing = this.byRole.get(roleId);
    if (existing) {
      existing.totalUsd += cost;
      existing.callCount += 1;
    } else {
      this.byRole.set(roleId, { totalUsd: cost, callCount: 1 });
    }
  }

  totalUsd(): number {
    return this.total;
  }

  breakdown(): UsageBreakdownEntry[] {
    const entries: UsageBreakdownEntry[] = [];
    for (const [roleId, { totalUsd, callCount }] of this.byRole.entries()) {
      entries.push({ roleId, totalUsd, callCount });
    }
    entries.sort((a, b) => b.totalUsd - a.totalUsd);
    return entries;
  }
}
