import type { SkillRegistry } from "@atlas/skill-runtime";
import { SkillMissingError } from "./errors.js";

export function assembleBrowserVerificationPrompt(
  registry: SkillRegistry,
  skillNames: string[]
): string {
  const sections: string[] = [];
  for (const name of skillNames) {
    const skill = registry.get(name);
    if (!skill) throw new SkillMissingError(name);
    sections.push(`## Skill: ${name}\n\n${skill.body.trim()}\n`);
  }
  return sections.join("\n---\n\n");
}
