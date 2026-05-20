import { dirname, join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Skill } from "./skill.js";
import type { IntentClassifier } from "./classifier.js";
import { SkillRegistry } from "./registry.js";
import { loadSkillsFromDir } from "./loader.js";

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

// Resolves the bundled skill-library path relative to this file's location in node_modules.
// In dev monorepo mode (pnpm workspace), node_modules/@atlas/skill-runtime/dist/ → repo root → packages/skill-library/skills.
function resolveBundledSkillsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Walk up until we find a directory containing `packages/skill-library/skills/`.
  let cursor = here;
  for (let i = 0; i < 10; i++) {
    const candidate = join(cursor, "packages", "skill-library", "skills");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`Could not locate packages/skill-library/skills/ from ${here}`);
}

export function loadBundledSkills(): Skill[] {
  const root = resolveBundledSkillsRoot();
  const groups = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(root, e.name));
  const out: Skill[] = [];
  for (const group of groups) {
    out.push(...loadSkillsFromDir(group));
  }
  return out;
}

/**
 * Creates a registry from the bundled library only (no local overrides).
 * Used in contexts where the user has no `.atlas/skills/` directory.
 */
export function createRegistryFromBundledLibrary(classifier?: IntentClassifier): SkillRegistry {
  return new SkillRegistry(loadBundledSkills(), classifier);
}
