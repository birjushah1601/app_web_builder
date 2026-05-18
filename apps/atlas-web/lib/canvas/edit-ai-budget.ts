/** Per-project per-day budget for editElementWithAI calls. Soft cap — the
 *  action checks `tryConsume` before dispatching the LLM call. State is
 *  in-memory + pinned to globalThis so HMR doesn't reset the count mid-session.
 *  Process restart wipes the count — acceptable since this is a dev-time cost
 *  guard, not an accounting system. */

const KEY = "__atlas_edit_ai_budget__";
type Store = Map<string, number>;
type WithStore = { [KEY]?: Store };

function getStore(): Store {
  const g = globalThis as unknown as WithStore;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function budgetKey(projectId: string): string {
  return `${projectId}:${todayUtc()}`;
}

function getDailyCap(): number {
  const raw = process.env.ATLAS_EDIT_AI_DAILY_CAP;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 50;
}

export interface BudgetState {
  used: number;
  cap: number;
  remaining: number;
  warning: boolean;   // true at >= 80% of cap
  exhausted: boolean; // true at >= cap
}

/** Returns the current state without consuming. */
export function readBudget(projectId: string): BudgetState {
  const store = getStore();
  const cap = getDailyCap();
  const used = store.get(budgetKey(projectId)) ?? 0;
  const remaining = Math.max(0, cap - used);
  return {
    used,
    cap,
    remaining,
    warning: used >= Math.floor(cap * 0.8),
    exhausted: used >= cap
  };
}

/** Attempts to consume one budget unit. Returns the post-consume state.
 *  When exhausted, does NOT increment (so the count stays at cap). */
export function tryConsume(projectId: string): BudgetState {
  const store = getStore();
  const cap = getDailyCap();
  const k = budgetKey(projectId);
  const used = store.get(k) ?? 0;
  if (used >= cap) {
    return readBudget(projectId);
  }
  store.set(k, used + 1);
  return readBudget(projectId);
}

/** Test-only helper. */
export function __resetEditAiBudgetForTesting(projectId?: string): void {
  const store = getStore();
  if (projectId) {
    store.delete(budgetKey(projectId));
  } else {
    store.clear();
  }
}
