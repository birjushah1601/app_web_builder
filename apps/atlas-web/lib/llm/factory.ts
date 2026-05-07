import { cache } from "react";
import type { LLMProvider } from "@atlas/llm-provider";
import type { ResearcherRole as TResearcherRole } from "@atlas/role-researcher";

/**
 * Lazily construct an LLMProvider from environment configuration.
 *
 * Provider precedence (matches lib/engine/factory.ts):
 *   1. ATLAS_LLM_BASE_URL → OpenAI-compatible local proxy (Claude Code CLI etc.)
 *   2. ANTHROPIC_API_KEY → official Anthropic SDK
 *   3. Neither → returns null (caller decides how to degrade)
 *
 * Wrapped in `cache()` so repeated calls within a single request reuse the
 * same provider instance.
 */
export const getLlmProvider = cache(async (): Promise<LLMProvider | null> => {
  if (process.env.ATLAS_LLM_BASE_URL) {
    const { OpenAICompatProvider } = await import("@/lib/engine/openai-compat-provider");
    return new OpenAICompatProvider({
      baseUrl: process.env.ATLAS_LLM_BASE_URL,
      apiKey: process.env.ATLAS_LLM_API_KEY ?? "sk-no-auth"
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { AnthropicProvider, createProviderMetrics } = await import("@atlas/llm-provider");
    const { Registry } = await import("prom-client");
    const sdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
  }
  return null;
});

/**
 * Plan S.2: construct the ResearcherRole when the feature flag is on.
 *
 * Gates:
 *   - `ATLAS_FF_RESEARCHER=true` — required; otherwise returns null.
 *   - `ATLAS_RESEARCH_WEB=true` AND `BRAVE_SEARCH_API_KEY` set — attaches
 *     BraveSearchAdapter for live web search. If the key is missing the
 *     role still constructs but degrades to catalog-only.
 *
 * The role is constructable + tested but not yet dispatched by the
 * RitualEngine — that wiring lands in Plan S.4. Until then, this function
 * exists so atlas-web can build the role on demand without crashing.
 */
export const getResearcherRole = cache(async (): Promise<TResearcherRole | null> => {
  if (process.env.ATLAS_FF_RESEARCHER !== "true") return null;

  const { ResearcherRole, BraveSearchAdapter } = await import("@atlas/role-researcher");
  const llm = await getLlmProvider();
  if (!llm) return null;

  const useWeb = process.env.ATLAS_RESEARCH_WEB === "true";
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  const webAdapter = useWeb && braveKey ? new BraveSearchAdapter({ apiKey: braveKey }) : null;

  return new ResearcherRole({ llm, webAdapter });
});
