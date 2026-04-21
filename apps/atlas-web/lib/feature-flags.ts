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
  | "auth-keycloak";

const FLAG_TO_ENV: Record<FeatureFlag, string> = {
  "figma-importer": "ATLAS_FF_FIGMA_IMPORTER",
  "stripe-payments": "ATLAS_FF_STRIPE_PAYMENTS",
  "video-kling": "ATLAS_FF_VIDEO_KLING",
  "auth-keycloak": "ATLAS_FF_AUTH_KEYCLOAK"
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
    "auth-keycloak": isFeatureEnabled("auth-keycloak", source)
  };
}
