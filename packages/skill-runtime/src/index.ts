// Frontmatter parsing + validation
export {
  SkillFrontmatterSchema,
  parseFrontmatter,
  validateFrontmatter
} from "./frontmatter.js";
export type { SkillFrontmatter, ParsedSkill } from "./frontmatter.js";

// Skill type
export type { Skill } from "./skill.js";

// Loader
export { loadSkillsFromDir } from "./loader.js";

// Intent classifier
export { MockIntentClassifier } from "./classifier.js";
export type {
  IntentClassifier,
  ClassificationResult,
  ClassificationMatch,
  OnClassificationHook,
  ClassifierOptions,
  SkillDescriptor
} from "./classifier.js";

// Registry
export {
  SkillRegistry,
  SkillNotFoundError,
  SkillInputValidationError
} from "./registry.js";
export type { ActivationRecord } from "./registry.js";

// Topological sort
export { topoSort, CyclicDependencyError } from "./topo.js";

// Pin file
export {
  SkillPinSchema,
  parsePinFile,
  loadPinFile,
  checkPinVersions,
  SkillVersionMismatchError
} from "./pin.js";
export type { SkillPin } from "./pin.js";

// Registry helpers
export {
  createRegistryWithOverrides,
  createRegistryFromBundledLibrary,
  loadBundledSkills
} from "./helpers.js";

export const PACKAGE_NAME = "@atlas/skill-runtime";
