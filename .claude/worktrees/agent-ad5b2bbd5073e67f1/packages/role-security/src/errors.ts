export class SecurityRoleError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecurityRoleError";
  }
}

export class SkillMissingError extends SecurityRoleError {
  constructor(skillName: string) {
    super(`Required skill not found in registry: "${skillName}"`);
    this.name = "SkillMissingError";
  }
}

export class SecurityCheckFailedError extends SecurityRoleError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecurityCheckFailedError";
  }
}
