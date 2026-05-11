import { NEXT_TS_V2_PROMPT } from "./sandbox-context-prompts/next-ts-v2.js";
import { FASTAPI_PROMPT } from "./sandbox-context-prompts/fastapi.js";

export const DEFAULT_TEMPLATE_NAME = "atlas-next-ts-v2";

const REGISTRY: Record<string, string> = {
  "atlas-next-ts-v2": NEXT_TS_V2_PROMPT,
  "atlas-fastapi": FASTAPI_PROMPT
};

/**
 * Look up the per-template developer prompt fragment. Falls back to the
 * default template's prompt when the requested template is unknown — graceful
 * degrade for v2 sub-plans that ship templates before their prompt fragments.
 */
export function getSandboxContextPrompt(templateName: string | undefined): string {
  if (!templateName) return REGISTRY[DEFAULT_TEMPLATE_NAME];
  return REGISTRY[templateName] ?? REGISTRY[DEFAULT_TEMPLATE_NAME];
}

export function listAvailableTemplates(): string[] {
  return Object.keys(REGISTRY);
}
