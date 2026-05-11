export class ResearcherFailedError extends Error {
  readonly cause?: unknown;
  readonly category?: string;

  constructor(message: string, opts: { cause?: unknown; category?: string } = {}) {
    super(message);
    this.name = "ResearcherFailedError";
    this.cause = opts.cause;
    this.category = opts.category;
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
    this.status = opts.status;
  }
}
