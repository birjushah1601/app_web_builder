export class BrowserVerificationRoleError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BrowserVerificationRoleError";
  }
}

export class SkillMissingError extends BrowserVerificationRoleError {
  constructor(skillName: string) {
    super(`Required skill not found in registry: "${skillName}"`);
    this.name = "SkillMissingError";
  }
}

export class BrowserCheckFailedError extends BrowserVerificationRoleError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BrowserCheckFailedError";
  }
}
