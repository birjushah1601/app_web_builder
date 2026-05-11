import type { SkillFrontmatter } from "./frontmatter.js";

/**
 * A fully-parsed skill: its validated frontmatter, the raw markdown body,
 * and the absolute path of the source file (for error messages).
 */
export interface Skill {
  frontmatter: SkillFrontmatter;
  body: string;
  sourcePath: string;
}
