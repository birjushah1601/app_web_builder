export class VisualQualityError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message);
    this.name = "VisualQualityError";
    this.cause = opts.cause;
  }
}

export class ScreenshotFailedError extends Error {
  readonly viewport?: string;
  override readonly cause?: unknown;
  constructor(message: string, opts: { viewport?: string; cause?: unknown } = {}) {
    super(message);
    this.name = "ScreenshotFailedError";
    if (opts.viewport !== undefined) this.viewport = opts.viewport;
    this.cause = opts.cause;
  }
}

export class SkillMissingError extends Error {
  readonly skillName: string;
  constructor(skillName: string) {
    super(`required skill missing: ${skillName}`);
    this.name = "SkillMissingError";
    this.skillName = skillName;
  }
}
