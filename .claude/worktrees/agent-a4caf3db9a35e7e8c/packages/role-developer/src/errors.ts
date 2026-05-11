export class DeveloperRoleError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeveloperRoleError";
  }
}

export class SkillMissingError extends DeveloperRoleError {
  constructor(skillName: string) {
    super(`Required skill not found in registry: "${skillName}"`);
    this.name = "SkillMissingError";
  }
}

export class BothProvidersFailedError extends DeveloperRoleError {
  readonly causes: Error[];
  constructor(message: string, options: { causes: Error[]; cause?: unknown }) {
    super(message, { cause: options.causes[0] });
    this.name = "BothProvidersFailedError";
    this.causes = options.causes;
  }
}

export class ReviewerFailedError extends DeveloperRoleError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReviewerFailedError";
  }
}
