/**
 * Feature flag registry. Flags are env-driven so they can be flipped per
 * deploy without code changes. Default: every flag OFF.
 *
 * Per ADR-001 (OSS stack pivot, 2026-04-21), Figma + Stripe paths exist as
 * UI affordances but their actions are gated on the corresponding flag.
 */

export type FeatureFlag =
  | "figma-importer"
  | "stripe-payments"
  | "video-kling"
  | "auth-keycloak"
  | "live-events"
  | "ritual-hydration"
  | "security-role"
  | "a11y-role"
  | "run-grafana"
  | "multi-turn"
  | "auto-fix-loop"
  | "demo-mode"
  | "editor-layout-v2"
  | "researcher"
  | "designer"
  | "canvas-v1"
  | "visual-quality-gate"
  | "multi-stack"
  | "prompt-morph"
  | "mode-toolbar"
  | "click-to-edit"
  | "reference-input"
  | "editable-plan"
  | "element-sliders"
  // Plan SPU — pipeline upgrade. Designer three-pass, reference imagery as
  // Designer input, AssetGenerator dispatch + its two image-source fallbacks.
  | "designer-critique"
  | "reference-images"
  | "asset-gen"
  | "hero-unsplash"
  | "hero-ai-image";

const FLAG_TO_ENV: Record<FeatureFlag, string> = {
  "figma-importer": "ATLAS_FF_FIGMA_IMPORTER",
  "stripe-payments": "ATLAS_FF_STRIPE_PAYMENTS",
  "video-kling": "ATLAS_FF_VIDEO_KLING",
  "auth-keycloak": "ATLAS_FF_AUTH_KEYCLOAK",
  // Per spec 2026-04-28-live-events-and-preview-reload-design.md, this flag
  // diverges from the ATLAS_FF_* convention — the spec mandates this exact
  // env name so operators can flip live events on a deploy without learning
  // the FF prefix convention.
  "live-events": "ATLAS_LIVE_EVENTS",
  // Plan H — same convention as live-events (no FF_ prefix) so operators
  // flip persistent ritual hydration on a deploy without learning the
  // convention.
  "ritual-hydration": "ATLAS_RITUAL_HYDRATION",
  // Plan I — per-role flags so an operator can flip Security on for an
  // audit run, leave Accessibility off while iterating on its prompts, etc.
  "security-role": "ATLAS_FF_SECURITY_ROLE",
  "a11y-role": "ATLAS_FF_A11Y_ROLE",
  // Plan J — gates the Run page's switch from placeholder HealthSummary
  // to real Grafana queries. Standard ATLAS_FF_* convention.
  "run-grafana": "ATLAS_FF_RUN_GRAFANA",
  // Plan K — multi-turn refinement (chat-style follow-ups on the same ritual lineage).
  "multi-turn": "ATLAS_FF_MULTI_TURN",
  // Plan L — auto-fix loop on gate failure (uses refine() under the hood; requires multi-turn).
  "auto-fix-loop": "ATLAS_FF_AUTO_FIX_LOOP",
  // Plan Q — demo mode: bypass LLM entirely, use canned architect+developer outputs.
  // Lets operators iterate on UI/UX without burning OpenRouter / Anthropic credits.
  "demo-mode": "ATLAS_FF_DEMO_MODE",
  // Plan R — editor layout v2 (two-zone resizable shell + status strip).
  "editor-layout-v2": "ATLAS_EDITOR_LAYOUT_V2",
  // Plan S.2 — Researcher role + 30-category catalog (catalog-only by default; web search opts in via ATLAS_RESEARCH_WEB).
  "researcher": "ATLAS_FF_RESEARCHER",
  // Plan S.3 — Designer role + A2UI primitive (proposal LLM call gated; A2UI components are unconditionally compiled but only mounted when canvas wires them in S.4).
  "designer": "ATLAS_FF_DESIGNER",
  // Plan S.4 — Canvas v1 (polymorphic shell + per-mode renderers; flag-OFF preserves preview-only Plan R behavior).
  "canvas-v1": "ATLAS_FF_CANVAS_V1",
  // Plan S.5 — Visual-Quality merge gate. When on, factory.getVisualQualityRole
  // constructs the role and the engine factory appends it to postDeveloperChain
  // after Security + A11y. Flag-OFF = today's chain unchanged.
  "visual-quality-gate": "ATLAS_FF_VISUAL_QUALITY_GATE",
  // Plan T.1 — Multi-stack templates. When on, the sandbox factory routes
  // architect's canvasManifest.artifactKind to a per-kind E2B template
  // (frontend-app → atlas-next-ts-v2, backend-rest-api → atlas-fastapi).
  // Flag-OFF preserves today's behavior — every project provisions atlas-next-ts-v2.
  "multi-stack": "ATLAS_FF_MULTI_STACK",
  // Plan UXO (2026-05-12-canvas-ux-overhaul) — six independently flag-gated
  // UX changes that lift Atlas's canvas to May-2026 SOTA. Each defaults OFF.
  // "prompt-morph" → renders PromptForm as a hero on `/` for signed-in users
  //                  and morphs the textarea into the canvas chat input via
  //                  the View Transitions API.
  "prompt-morph": "ATLAS_FF_PROMPT_MORPH",
  // "mode-toolbar" → three-mode (Agent/Plan/Visual-Edits) radio in the
  //                  canvas header. Visible only; consumer wiring comes in
  //                  follow-up UXO slices.
  "mode-toolbar": "ATLAS_FF_MODE_TOOLBAR",
  // "click-to-edit" → IframeOverlay renders hit-zones over the preview
  //                   driven by a postMessage DOM tree from the sandbox.
  "click-to-edit": "ATLAS_FF_CLICK_TO_EDIT",
  // "reference-input" → ReferenceDropZone in PromptForm + ChatPanel for
  //                     drag/drop / paste-URL style-match references.
  "reference-input": "ATLAS_FF_REFERENCE_INPUT",
  // "editable-plan" → PlanCheckpoints (editable architect plan) +
  //                   CritiqueDisclosure (collapsed designer.critique).
  "editable-plan": "ATLAS_FF_EDITABLE_PLAN",
  // "element-sliders" → ElementInspector with Haiku-proposed axes that
  //                     patch design-tokens.json or scoped Tailwind classes.
  "element-sliders": "ATLAS_FF_ELEMENT_SLIDERS",
  // Plan SPU (2026-05-12-stunning-pipeline-upgrade) — five independently
  // flag-gated pipeline upgrades. Each defaults OFF.
  // "designer-critique" → 3-pass Designer (draft → critique → revise) for
  //                       higher-quality proposals at +latency +cost.
  "designer-critique": "ATLAS_FF_DESIGNER_CRITIQUE",
  // "reference-images" → architect threads user-uploaded reference imagery
  //                      through priorArtifact for Designer to honor.
  "reference-images": "ATLAS_FF_REFERENCE_IMAGES",
  // "asset-gen" → AssetGenerator dispatched by the engine after the canvas
  //               pause; produces hero + section image URLs for Developer.
  "asset-gen": "ATLAS_FF_ASSET_GEN",
  // "hero-unsplash" → Unsplash fallback for hero. Requires UNSPLASH_ACCESS_KEY.
  "hero-unsplash": "ATLAS_FF_HERO_UNSPLASH",
  // "hero-ai-image" → gpt-image-1 hero. Requires OPENAI_API_KEY.
  "hero-ai-image": "ATLAS_FF_HERO_AI_IMAGE"
};

export interface FeatureFlagSource {
  /** Returns the value of the env var, or undefined if not set. */
  readEnv(name: string): string | undefined;
  /**
   * Optional per-request override layer. When defined and the flag has a
   * cookie mapping, the cookie value takes precedence over the env var.
   * Cookies expose only an explicit ON/OFF — any other string falls
   * through to env. Used by Plan Q's runtime demo-mode toggle so an
   * operator can flip demo mode from the UI without redeploying.
   */
  readCookie?(name: string): string | undefined;
}

export const processEnvSource: FeatureFlagSource = {
  readEnv: (name) => process.env[name]
};

/**
 * Per-flag cookie names. Only the flags that participate in runtime UI
 * toggles get an entry here — every other flag is env-only. Each cookie
 * accepts ONLY "true" or "false" (anything else falls through to env so
 * a stale/garbage cookie never silently overrides production env config).
 */
const FLAG_TO_COOKIE: Partial<Record<FeatureFlag, string>> = {
  // Plan Q.UI — runtime demo-mode toggle in the canvas header. Cookie ON
  // beats env OFF; cookie OFF beats env ON; cookie unset = env wins.
  // HttpOnly is intentionally false on the client setter (the toggle is
  // per-browser convenience, not a security boundary — the server still
  // checks the same cookie via this source).
  "demo-mode": "atlas-demo-mode"
};

const TRUTHY = new Set(["1", "true", "TRUE", "yes", "on"]);

/** Strict cookie parser. Returns true/false for explicit values, undefined
 *  for anything else (so the env fallback runs). Kept narrow on purpose —
 *  cookies are user-controlled input and we don't want to honor garbage. */
function parseCookieValue(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return undefined;
}

export function isFeatureEnabled(
  flag: FeatureFlag,
  source: FeatureFlagSource = processEnvSource
): boolean {
  // Cookie precedence — if the flag participates in the runtime override
  // layer AND the source provides a readCookie AND the cookie carries an
  // explicit true/false, return that immediately. Falls through to env in
  // every other case (no source.readCookie, no cookie set, garbage value).
  const cookieName = FLAG_TO_COOKIE[flag];
  if (cookieName !== undefined && source.readCookie !== undefined) {
    const cookieDecision = parseCookieValue(source.readCookie(cookieName));
    if (cookieDecision !== undefined) return cookieDecision;
  }

  const envName = FLAG_TO_ENV[flag];
  const raw = source.readEnv(envName);
  if (raw === undefined) return false;
  return TRUTHY.has(raw.trim());
}

/** Cookie name for a flag, or undefined if the flag is env-only. Exported
 *  so the UI toggle + Server Action can name the cookie consistently
 *  without hard-coding the string in two places. */
export function getCookieNameForFlag(flag: FeatureFlag): string | undefined {
  return FLAG_TO_COOKIE[flag];
}

export function listFlagStates(source: FeatureFlagSource = processEnvSource): Record<FeatureFlag, boolean> {
  return {
    "figma-importer": isFeatureEnabled("figma-importer", source),
    "stripe-payments": isFeatureEnabled("stripe-payments", source),
    "video-kling": isFeatureEnabled("video-kling", source),
    "auth-keycloak": isFeatureEnabled("auth-keycloak", source),
    "live-events": isFeatureEnabled("live-events", source),
    "ritual-hydration": isFeatureEnabled("ritual-hydration", source),
    "security-role": isFeatureEnabled("security-role", source),
    "a11y-role": isFeatureEnabled("a11y-role", source),
    "run-grafana": isFeatureEnabled("run-grafana", source),
    "multi-turn": isFeatureEnabled("multi-turn", source),
    "auto-fix-loop": isFeatureEnabled("auto-fix-loop", source),
    "demo-mode": isFeatureEnabled("demo-mode", source),
    "editor-layout-v2": isFeatureEnabled("editor-layout-v2", source),
    "researcher": isFeatureEnabled("researcher", source),
    "designer": isFeatureEnabled("designer", source),
    "canvas-v1": isFeatureEnabled("canvas-v1", source),
    "visual-quality-gate": isFeatureEnabled("visual-quality-gate", source),
    "multi-stack": isFeatureEnabled("multi-stack", source),
    "prompt-morph": isFeatureEnabled("prompt-morph", source),
    "mode-toolbar": isFeatureEnabled("mode-toolbar", source),
    "click-to-edit": isFeatureEnabled("click-to-edit", source),
    "reference-input": isFeatureEnabled("reference-input", source),
    "editable-plan": isFeatureEnabled("editable-plan", source),
    "element-sliders": isFeatureEnabled("element-sliders", source),
    "designer-critique": isFeatureEnabled("designer-critique", source),
    "reference-images": isFeatureEnabled("reference-images", source),
    "asset-gen": isFeatureEnabled("asset-gen", source),
    "hero-unsplash": isFeatureEnabled("hero-unsplash", source),
    "hero-ai-image": isFeatureEnabled("hero-ai-image", source)
  };
}
