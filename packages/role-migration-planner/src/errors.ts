export class MigrationPlannerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MigrationPlannerError";
  }
}

export class SkillMissingError extends MigrationPlannerError {
  constructor(skillName: string) {
    super(`Required skill not found in registry: "${skillName}"`);
    this.name = "SkillMissingError";
  }
}

export class MigrationPlanGenerationError extends MigrationPlannerError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MigrationPlanGenerationError";
  }
}
