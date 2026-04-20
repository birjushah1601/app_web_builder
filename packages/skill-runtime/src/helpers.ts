import type { Skill } from "./skill.js";
import type { IntentClassifier } from "./classifier.js";
import { SkillRegistry } from "./registry.js";

/**
 * Merges bundled (library) skills and local override skills into a single
 * `SkillRegistry`. Local skills with the same name as a bundled skill win.
 *
 * @param bundled  - Skills loaded from the bundled library (e.g. `packages/skill-library/src/`).
 * @param local    - Skills loaded from `.atlas/skills/` in the user's workspace.
 * @param classifier - Optional intent classifier; injected by D.1 in production.
 */
export function createRegistryWithOverrides(
  bundled: Skill[],
  local: Skill[],
  classifier?: IntentClassifier
): SkillRegistry {
  const merged = new Map<string, Skill>(bundled.map((s) => [s.frontmatter.name, s]));
  for (const skill of local) {
    merged.set(skill.frontmatter.name, skill); // local wins
  }
  return new SkillRegistry([...merged.values()], classifier);
}

/**
 * Placeholder for the C.2 bundled library path.
 * When C.2 ships `packages/skill-library/`, this helper will load from that
 * directory. For C.1, returns an empty array — the library has no skills yet.
 */
export function loadBundledSkills(): Skill[] {
  // C.2 will replace this stub with:
  //   import { fileURLToPath } from "node:url";
  //   const LIBRARY_DIR = fileURLToPath(new URL("../../skill-library/src", import.meta.url));
  //   return loadSkillsFromDir(LIBRARY_DIR);
  return [];
}

/**
 * Creates a registry from the bundled library only (no local overrides).
 * Used in contexts where the user has no `.atlas/skills/` directory.
 */
export function createRegistryFromBundledLibrary(classifier?: IntentClassifier): SkillRegistry {
  return new SkillRegistry(loadBundledSkills(), classifier);
}
