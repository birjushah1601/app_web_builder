export class NoGeneratorForKindError extends Error {
  constructor(kind: string) {
    super(`NoGeneratorForKindError: no test-generator skill registered for node kind "${kind}"`);
    this.name = "NoGeneratorForKindError";
  }
}

export class BaselineMissingError extends Error {
  constructor(kind: string) {
    super(
      `BaselineMissingError: no human baseline file for kind "${kind}" — author one at .atlas/baselines/${kind}.yaml`
    );
    this.name = "BaselineMissingError";
  }
}

export class BaselineFileParseError extends Error {
  constructor(path: string, cause: unknown) {
    super(
      `BaselineFileParseError: failed to parse baseline file at ${path}: ${(cause as Error).message}`
    );
    this.name = "BaselineFileParseError";
  }
}

export class DriftExceededError extends Error {
  constructor(driftedCount: number, total: number) {
    super(`DriftExceededError: ${driftedCount}/${total} calibration entries drifted`);
    this.name = "DriftExceededError";
  }
}
