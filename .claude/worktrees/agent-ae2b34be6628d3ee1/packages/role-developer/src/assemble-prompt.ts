import type { SkillRegistry } from "@atlas/skill-runtime";
import { SkillMissingError } from "./errors.js";
import { getSandboxContextPrompt, DEFAULT_TEMPLATE_NAME } from "./sandbox-context-registry.js";

/**
 * Backwards-compatible export: returns the default template's prompt fragment
 * (atlas-next-ts-v2). Existing callers that don't pass `targetTemplate` get
 * unchanged behavior. Plan T.1+ callers should use `getSandboxContextPromptFor`.
 */
export const SANDBOX_CONTEXT_PROMPT = getSandboxContextPrompt(undefined);

/**
 * Per-template lookup. Pass the template name (e.g. "atlas-fastapi") to get
 * the right prompt fragment. Undefined → default. Unknown → default
 * (graceful degrade).
 */
export function getSandboxContextPromptFor(templateName: string | undefined): string {
  return getSandboxContextPrompt(templateName);
}

export { DEFAULT_TEMPLATE_NAME };

export function assembleDeveloperPrompt(registry: SkillRegistry, skillNames: string[]): string {
  const sections: string[] = [];
  for (const name of skillNames) {
    const skill = registry.get(name);
    if (!skill) throw new SkillMissingError(name);
    sections.push(`## Skill: ${name}\n\n${skill.body.trim()}\n`);
  }
  return sections.join("\n---\n\n");
}
