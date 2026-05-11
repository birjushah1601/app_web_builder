import type { Scope } from "./types.js";

export class ArchitectError extends Error {
  readonly cause?: unknown;
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "ArchitectError";
    this.cause = options.cause;
  }
}

export class SkillMissingError extends ArchitectError {
  readonly skillName: string;
  constructor(skillName: string) {
    super(`required skill missing from registry: ${skillName}`);
    this.name = "SkillMissingError";
    this.skillName = skillName;
  }
}

export class TriageFailedError extends ArchitectError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "TriageFailedError";
  }
}

export class DeepPlanFailedError extends ArchitectError {
  readonly scope?: Scope;
  constructor(message: string, options: { cause?: unknown; scope?: Scope } = {}) {
    super(message, { cause: options.cause });
    this.name = "DeepPlanFailedError";
    this.scope = options.scope;
  }
}
