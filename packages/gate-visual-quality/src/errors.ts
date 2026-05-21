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

export type InfraSignature =
  | "puppeteer-core-missing"
  | "chromium-launch-failed"
  | "module-not-found-generic";

// Thrown when a screenshot can't be captured for reasons the LLM didn't
// cause and can't fix (sandbox lacks puppeteer-core / chromium binary
// missing / browser launch ENOENT). The role treats this as a graceful
// skip — emits visual_quality.skipped, returns passed:true,skipped:true
// — so the auto-fix loop doesn't burn retries on infra problems.
export class InfrastructureUnavailableError extends Error {
  readonly signature: InfraSignature;
  readonly viewport?: string;
  override readonly cause?: unknown;
  constructor(
    message: string,
    opts: { signature: InfraSignature; viewport?: string; cause?: unknown }
  ) {
    super(message);
    this.name = "InfrastructureUnavailableError";
    this.signature = opts.signature;
    if (opts.viewport !== undefined) this.viewport = opts.viewport;
    this.cause = opts.cause;
  }
}
