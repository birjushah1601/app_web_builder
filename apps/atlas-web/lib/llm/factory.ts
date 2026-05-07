import { cache } from "react";
import type { LLMProvider } from "@atlas/llm-provider";
import type { ResearcherRole as TResearcherRole } from "@atlas/role-researcher";
import type { DesignerRole as TDesignerRole } from "@atlas/role-designer";
import type {
  VisualQualityRole as TVisualQualityRole,
  SandboxExec as TSandboxExec
} from "@atlas/gate-visual-quality";

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

/**
 * Plan S.3: construct the DesignerRole when the feature flag is on.
 *
 * Lazy + per-request cached. Returns the DesignerRole if ATLAS_FF_DESIGNER=true
 * AND the LLM provider env is configured; null otherwise. The role is
 * constructed but NOT yet dispatched by getRitualEngine — that wiring lands
 * in Plan S.4 (canvas + engine integration). For now this gives atlas-web
 * a typed handle so the canvas tests can mount the role in isolation.
 */
export const getDesignerRole = cache(async (): Promise<TDesignerRole | null> => {
  const { isFeatureEnabled } = await import("@/lib/feature-flags");
  if (!isFeatureEnabled("designer")) return null;

  const llm = await getLlmProvider();
  if (!llm) return null;

  const { DesignerRole } = await import("@atlas/role-designer");
  return new DesignerRole({ llm });
});

/**
 * Plan S.5: construct the VisualQualityRole when the feature flag is on.
 *
 * Gates:
 *   - `ATLAS_FF_VISUAL_QUALITY_GATE=true` — required; otherwise returns null.
 *   - `ATLAS_VQ_GATE_MODEL` — optional model override forwarded to the role
 *     (default: package-internal `VQ_GATE_MODEL`, a Sonnet-class multimodal).
 *
 * Caller supplies the live SandboxExec + previewUrl because the role needs
 * an in-sandbox shell (E2B's process API) plus the URL the preview iframe
 * is rendering against. Mirrors getResearcherRole / getDesignerRole.
 *
 * Per-request cache is keyed by (exec, previewUrl) — React's `cache()` does
 * shallow argument identity, which matches our usage (each request resolves
 * the same pair).
 */
export const getVisualQualityRole = cache(
  async (params: {
    exec: TSandboxExec;
    previewUrl: string;
  }): Promise<TVisualQualityRole | null> => {
    const { isFeatureEnabled } = await import("@/lib/feature-flags");
    if (!isFeatureEnabled("visual-quality-gate")) return null;

    const llm = await getLlmProvider();
    if (!llm) return null;

    const { VisualQualityRole } = await import("@atlas/gate-visual-quality");
    const { SkillRegistry, loadSkillsFromDir } = await import("@atlas/skill-runtime");
    const { resolve } = await import("node:path");

    const skillsRoot = resolve(
      process.cwd(),
      "..",
      "..",
      "packages",
      "skill-library",
      "skills",
      "visual-quality"
    );
    const skills = new SkillRegistry(await loadSkillsFromDir(skillsRoot));

    const model = process.env.ATLAS_VQ_GATE_MODEL;
    return new VisualQualityRole({
      llm,
      skills,
      exec: params.exec,
      previewUrl: params.previewUrl,
      ...(model ? { model } : {})
    });
  }
);
