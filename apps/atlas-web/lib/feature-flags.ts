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
  | "designer"
  | "canvas-v1"
  | "visual-quality-gate"
  | "multi-stack";

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
  "multi-stack": "ATLAS_FF_MULTI_STACK"
};

export interface FeatureFlagSource {
  /** Returns the value of the env var, or undefined if not set. */
  readEnv(name: string): string | undefined;
}

export const processEnvSource: FeatureFlagSource = {
  readEnv: (name) => process.env[name]
};

const TRUTHY = new Set(["1", "true", "TRUE", "yes", "on"]);

export function isFeatureEnabled(
  flag: FeatureFlag,
  source: FeatureFlagSource = processEnvSource
): boolean {
  const envName = FLAG_TO_ENV[flag];
  const raw = source.readEnv(envName);
  if (raw === undefined) return false;
  return TRUTHY.has(raw.trim());
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
    "designer": isFeatureEnabled("designer", source),
    "canvas-v1": isFeatureEnabled("canvas-v1", source),
    "visual-quality-gate": isFeatureEnabled("visual-quality-gate", source),
    "multi-stack": isFeatureEnabled("multi-stack", source)
  };
}
