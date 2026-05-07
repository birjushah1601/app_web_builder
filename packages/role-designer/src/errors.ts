export type DesignerFailureReason =
  | "llm-timeout"
  | "llm-error"
  | "schema-mismatch"
  | "missing-tool-call"
  | "unknown";

export class DesignerFailedError extends Error {
  readonly cause?: unknown;
  readonly reason: DesignerFailureReason;

  constructor(message: string, opts: { cause?: unknown; reason?: DesignerFailureReason } = {}) {
    super(message);
    this.name = "DesignerFailedError";
    this.cause = opts.cause;
    this.reason = opts.reason ?? "unknown";
  }
}

export class RefineAxisError extends Error {
  readonly axis: string;

  constructor(message: string, opts: { axis: string }) {
    super(message);
    this.name = "RefineAxisError";
    this.axis = opts.axis;
  }
}
