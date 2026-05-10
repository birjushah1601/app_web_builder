/**
 * Static registry of per-model capability flags for the LLM providers we
 * route through OpenRouter (and a handful of direct-Anthropic equivalents).
 *
 * Why a registry instead of probing each model on first call?
 *   - OpenRouter returns HTTP 404 with body
 *     `"No endpoints found that support tool use"` for models whose only
 *     hosted endpoint lacks tool-use (Qwen 2.5 family bit us 2026-05-08).
 *     A static check up-front lets the caller avoid the doomed request
 *     entirely — and lets the provider choose the right fallback shape
 *     before the first round-trip.
 *   - Context windows feed into our slicing strategy (architect deep-plans
 *     can chew through 32k easily on large repos). The number is advisory,
 *     not enforced; OpenRouter still rejects when exceeded.
 *
 * For unknown models we assume a conservative tools-supported default
 * (most current OpenAI/Anthropic/Google/DeepSeek hosts do) and log a
 * one-shot warning so the developer notices.
 */

export interface ModelCapabilities {
  supportsTools: boolean;
  supportsVision: boolean;
  /** Token budget the model claims to accept on a single request. */
  contextWindow: number;
}

const REGISTRY: Readonly<Record<string, ModelCapabilities>> = {
  // ─── Anthropic Claude (via OpenRouter or direct) ─────────────────────────
  "anthropic/claude-haiku-4.5":   { supportsTools: true,  supportsVision: true,  contextWindow: 200_000 },
  "anthropic/claude-sonnet-4.5":  { supportsTools: true,  supportsVision: true,  contextWindow: 200_000 },
  "anthropic/claude-opus-4-7":    { supportsTools: true,  supportsVision: true,  contextWindow: 200_000 },
  // Local-proxy rebadged names (no provider prefix, used by
  // claude-max-api-proxy on :3456).
  "claude-haiku-4-5":             { supportsTools: true,  supportsVision: true,  contextWindow: 200_000 },
  "claude-sonnet-4":              { supportsTools: true,  supportsVision: true,  contextWindow: 200_000 },
  "claude-sonnet-4.5":            { supportsTools: true,  supportsVision: true,  contextWindow: 200_000 },
  "claude-opus-4-7":              { supportsTools: true,  supportsVision: true,  contextWindow: 200_000 },

  // ─── Google Gemini ───────────────────────────────────────────────────────
  "google/gemini-2.5-flash":      { supportsTools: true,  supportsVision: true,  contextWindow: 1_000_000 },
  "google/gemini-2.5-pro":        { supportsTools: true,  supportsVision: true,  contextWindow: 1_000_000 },

  // ─── DeepSeek ────────────────────────────────────────────────────────────
  "deepseek/deepseek-chat":       { supportsTools: true,  supportsVision: false, contextWindow: 64_000 },
  "deepseek/deepseek-coder":      { supportsTools: true,  supportsVision: false, contextWindow: 64_000 },

  // ─── Qwen 2.5 family — OpenRouter endpoints DO NOT support tool_use ──────
  // (verified 2026-05-08 — every developer dispatch returned HTTP 404 with
  // "No endpoints found that support tool use"). Mark explicitly so the
  // provider takes the schema-injection path on the first attempt.
  "qwen/qwen-2.5-72b-instruct":      { supportsTools: false, supportsVision: false, contextWindow: 32_000 },
  "qwen/qwen-2.5-coder-32b-instruct":{ supportsTools: false, supportsVision: false, contextWindow: 32_000 },

  // ─── Meta Llama 3.3 ──────────────────────────────────────────────────────
  // OpenRouter currently exposes Llama 3.3 70b without tool_use on most
  // hosts. Treat as schema-injection until we see otherwise.
  "meta-llama/llama-3.3-70b-instruct": { supportsTools: false, supportsVision: false, contextWindow: 128_000 },

  // ─── OpenAI (mainly for parity / GPT-4o-mini fallback experiments) ───────
  "openai/gpt-4o-mini":           { supportsTools: true,  supportsVision: true,  contextWindow: 128_000 },
  "openai/gpt-4o":                { supportsTools: true,  supportsVision: true,  contextWindow: 128_000 }
};

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  supportsTools: true,
  supportsVision: false,
  contextWindow: 32_000
};

// One-shot warning de-dupe keyed by model id. Keeps stdout quiet when the
// same unknown model is referenced thousands of times across a long-lived
// process. Reset is intentionally absent — a process restart is the only
// reason a fresh warning is useful.
const warnedUnknown = new Set<string>();

/**
 * Look up the static capability profile for a model id.
 *
 * Lookup order:
 *   1. Exact match against the registry.
 *   2. Default ({ supportsTools: true, supportsVision: false, contextWindow: 32k })
 *      with a one-shot console.warn so the developer notices.
 *
 * @param modelId The provider-prefixed model id (e.g. "anthropic/claude-haiku-4.5").
 *                Local-proxy unprefixed ids (e.g. "claude-sonnet-4") also resolve.
 */
export function getModelCapabilities(modelId: string): ModelCapabilities {
  const entry = REGISTRY[modelId];
  if (entry) return entry;

  if (!warnedUnknown.has(modelId)) {
    warnedUnknown.add(modelId);
    console.warn(
      `[model-capabilities] unknown model "${modelId}" — defaulting to ` +
        `{ supportsTools: true, supportsVision: false, contextWindow: 32000 }. ` +
        `Add an entry to apps/atlas-web/lib/llm/model-capabilities.ts to silence this warning.`
    );
  }
  return DEFAULT_CAPABILITIES;
}

/**
 * Test-only helper: clears the one-shot unknown-model warning de-dupe set so
 * unit tests can assert the warning fires on each unknown lookup.
 *
 * Not exported in the public surface — consumers should not need this.
 */
export function __resetUnknownWarningsForTests(): void {
  warnedUnknown.clear();
}
