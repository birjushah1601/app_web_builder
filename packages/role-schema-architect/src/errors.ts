export type SchemaArchitectFailureReason =
  | "llm-error"
  | "schema-mismatch"
  | "broken-reference"
  | "duplicate-name";

export class SchemaArchitectFailedError extends Error {
  readonly reason: SchemaArchitectFailureReason;
  override readonly cause?: unknown;
  constructor(message: string, opts: { reason: SchemaArchitectFailureReason; cause?: unknown }) {
    super(message);
    this.name = "SchemaArchitectFailedError";
    this.reason = opts.reason;
    this.cause = opts.cause;
  }
}
