import { NEXT_TS_V2_PROMPT } from "./sandbox-context-prompts/next-ts-v2.js";
import { FASTAPI_PROMPT } from "./sandbox-context-prompts/fastapi.js";
import { HONO_BUN_PROMPT } from "./sandbox-context-prompts/hono-bun.js";
import { GRAPHQL_YOGA_PROMPT } from "./sandbox-context-prompts/graphql-yoga.js";
import { EXPO_RN_PROMPT } from "./sandbox-context-prompts/expo-rn.js";
import { DLT_PYTHON_PROMPT } from "./sandbox-context-prompts/dlt-python.js";
import { BUN_CLI_PROMPT } from "./sandbox-context-prompts/bun-cli.js";

export const DEFAULT_TEMPLATE_NAME = "atlas-next-ts-v2";

const REGISTRY: Record<string, string> = {
  "atlas-next-ts-v2": NEXT_TS_V2_PROMPT,
  "atlas-fastapi": FASTAPI_PROMPT,
  "atlas-hono-bun": HONO_BUN_PROMPT,
  "atlas-graphql-yoga": GRAPHQL_YOGA_PROMPT,
  "atlas-expo-rn": EXPO_RN_PROMPT,
  "atlas-dlt-python": DLT_PYTHON_PROMPT,
  "atlas-bun-cli": BUN_CLI_PROMPT
};

/**
 * Look up the per-template developer prompt fragment. Falls back to the
 * default template's prompt when the requested template is unknown — graceful
 * degrade for v3+ sub-plans that ship templates before their prompt fragments.
 */
export function getSandboxContextPrompt(templateName: string | undefined): string {
  if (!templateName) return REGISTRY[DEFAULT_TEMPLATE_NAME];
  return REGISTRY[templateName] ?? REGISTRY[DEFAULT_TEMPLATE_NAME];
}

export function listAvailableTemplates(): string[] {
  return Object.keys(REGISTRY);
}
