import yaml from "js-yaml";
import { z } from "zod";

/**
 * Canonical shape of skill frontmatter.
 * `inputs` and `outputs` are stored as `unknown` at parse time;
 * individual skills supply Zod schemas that callers evaluate.
 * Name must be a kebab/snake identifier with no spaces.
 */
export const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/, "name must contain only word characters and hyphens"),
  description: z.string().min(1),
  activate_on: z.array(z.string().min(1)).min(1),
  composes: z.array(z.string().min(1)).optional(),
  model_hint: z.string().optional(),
  inputs: z.unknown().optional(),
  outputs: z.unknown().optional()
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export function validateFrontmatter(raw: unknown): SkillFrontmatter {
  return SkillFrontmatterSchema.parse(raw);
}

export interface ParsedSkill {
  frontmatter: unknown;
  body: string;
}

/**
 * Splits a skill markdown file into its YAML frontmatter object and body text.
 * Frontmatter must be fenced by `---` lines at the very start of the file.
 * Files with no opening `---` are returned with an empty frontmatter object.
 * Throws a descriptive error (wrapping js-yaml's YAMLException) if the YAML
 * between the delimiters is syntactically invalid.
 */
export function parseFrontmatter(markdown: string): ParsedSkill {
  const DELIMITER = "---";

  if (!markdown.startsWith(DELIMITER)) {
    return { frontmatter: {}, body: markdown };
  }

  const afterFirst = markdown.slice(DELIMITER.length);
  const secondDelimIdx = afterFirst.indexOf("\n" + DELIMITER);

  if (secondDelimIdx === -1) {
    return { frontmatter: {}, body: markdown };
  }

  const yamlText = afterFirst.slice(0, secondDelimIdx);
  const body = afterFirst.slice(secondDelimIdx + ("\n" + DELIMITER).length);

  let frontmatter: unknown;
  try {
    frontmatter = yaml.load(yamlText) ?? {};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`YAML parse error in skill frontmatter: ${msg}`);
  }

  return { frontmatter, body };
}
