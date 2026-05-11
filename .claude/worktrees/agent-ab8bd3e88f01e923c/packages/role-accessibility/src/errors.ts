export class AccessibilityRoleError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AccessibilityRoleError";
  }
}

export class SkillMissingError extends AccessibilityRoleError {
  constructor(skillName: string) {
    super(`Required skill not found in registry: "${skillName}"`);
    this.name = "SkillMissingError";
  }
}

export class AccessibilityCheckFailedError extends AccessibilityRoleError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AccessibilityCheckFailedError";
  }
}
