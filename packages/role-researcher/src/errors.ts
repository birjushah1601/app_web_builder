export class ResearcherFailedError extends Error {
  override readonly cause?: unknown;
  readonly category?: string;

  constructor(message: string, opts: { cause?: unknown; category?: string } = {}) {
    super(message);
    this.name = "ResearcherFailedError";
    if (opts.cause !== undefined) this.cause = opts.cause;
    if (opts.category !== undefined) this.category = opts.category;
  }
}

export class CatalogParseError extends Error {
  readonly file: string;

  constructor(message: string, opts: { file: string }) {
    super(message);
    this.name = "CatalogParseError";
    this.file = opts.file;
  }
}

export class WebFetchError extends Error {
  readonly provider: string;
  readonly status?: number;

  constructor(message: string, opts: { provider: string; status?: number; cause?: unknown }) {
    super(message);
    this.name = "WebFetchError";
    this.provider = opts.provider;
    if (opts.status !== undefined) this.status = opts.status;
  }
}
