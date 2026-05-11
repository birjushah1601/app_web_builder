import fs from "node:fs";
import path from "node:path";
import type { Skill } from "./skill.js";
import { parseFrontmatter, validateFrontmatter } from "./frontmatter.js";

/**
 * Reads every `*.md` file in `dir`, parses frontmatter + body, and returns
 * the resulting `Skill[]`. Files that fail frontmatter validation are skipped
 * with a `console.warn` rather than crashing the loader — a bad user-authored
 * skill should not prevent the rest of the library from loading.
 * Returns `[]` if the directory does not exist.
 */
export function loadSkillsFromDir(dir: string): Skill[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const sourcePath = path.resolve(dir, entry.name);
    const raw = fs.readFileSync(sourcePath, "utf-8");

    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(raw);
    } catch (err) {
      console.warn(`[skill-runtime] Skipping ${sourcePath}: YAML parse error — ${String(err)}`);
      continue;
    }

    let frontmatter: ReturnType<typeof validateFrontmatter>;
    try {
      frontmatter = validateFrontmatter(parsed.frontmatter);
    } catch (err) {
      console.warn(`[skill-runtime] Skipping ${sourcePath}: invalid frontmatter — ${String(err)}`);
      continue;
    }

    skills.push({ frontmatter, body: parsed.body, sourcePath });
  }

  return skills;
}
