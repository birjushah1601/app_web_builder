import fs from "node:fs";
import { z } from "zod";
import type { Skill } from "./skill.js";

/**
 * A single entry in `.atlas/skills/pin.json`.
 * `version` must be a semver string (major.minor.patch with optional pre-release).
 * `provenance` identifies the source: "bundled" | "local" | a URL string.
 */
export const SkillPinSchema = z.object({
  skill: z.string().min(1),
  version: z
    .string()
    .regex(
      /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/,
      'version must be a semver string, e.g. "1.2.3" or "1.0.0-beta.1"'
    ),
  provenance: z.string().min(1)
});

export type SkillPin = z.infer<typeof SkillPinSchema>;

const SkillPinArraySchema = z.array(SkillPinSchema);

/**
 * Validates raw JSON (already parsed) against the SkillPin[] schema.
 * Throws a Zod error with structured issues on failure.
 */
export function parsePinFile(raw: unknown): SkillPin[] {
  return SkillPinArraySchema.parse(raw);
}

/**
 * Reads, JSON-parses, and validates a pin.json file.
 * Returns `[]` if the file does not exist.
 * Throws if the file exists but is invalid JSON or fails schema validation.
 */
export function loadPinFile(filePath: string): SkillPin[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  return parsePinFile(raw);
}

export class SkillVersionMismatchError extends Error {
  readonly skillName: string;
  readonly pinned: string;
  readonly loaded: string | undefined;

  constructor(skillName: string, pinned: string, loaded: string | undefined) {
    super(
      `SkillVersionMismatchError: skill "${skillName}" is pinned at ${pinned} but loaded version is ${loaded ?? "(none)"}`
    );
    this.name = "SkillVersionMismatchError";
    this.skillName = skillName;
    this.pinned = pinned;
    this.loaded = loaded;
  }
}

/**
 * Checks that every pinned skill, if present in `loadedSkills`, has a
 * `version` field matching the pin exactly. Pinned skills absent from
 * `loadedSkills` are silently ignored (they may be optional or not yet loaded).
 *
 * Note: `version` is not part of `SkillFrontmatterSchema` v1 — it is an
 * extra field passed through via `z.unknown()`. Skills that carry a `version`
 * in their frontmatter will have it available as a raw property; skills that
 * do not carry one are treated as unversioned and fail the check when pinned.
 */
export function checkPinVersions(pins: SkillPin[], loadedSkills: Skill[]): void {
  const byName = new Map(loadedSkills.map((s) => [s.frontmatter.name, s]));

  for (const pin of pins) {
    const skill = byName.get(pin.skill);
    if (!skill) continue; // not loaded — silently skip

    const frontmatterRaw = skill.frontmatter as Record<string, unknown>;
    const loadedVersion = typeof frontmatterRaw.version === "string"
      ? frontmatterRaw.version
      : undefined;

    if (loadedVersion !== pin.version) {
      throw new SkillVersionMismatchError(pin.skill, pin.version, loadedVersion);
    }
  }
}
