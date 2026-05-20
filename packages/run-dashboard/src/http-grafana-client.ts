import type {
  GrafanaClient,
  PromQueryInstantInput,
  PromQueryInstantResult,
  PromQueryRangeInput,
  PromQueryRangeResult
} from "./grafana-client.js";

export interface HttpGrafanaClientOptions {
  /** Base URL of the Grafana datasource-proxy endpoint for Prometheus (e.g., https://grafana.atlas.app/api/datasources/proxy/1). */
  baseUrl: string;
  /** Bearer token for Grafana API. */
  token: string;
  /** Default step seconds for `queryRange` when caller omits it. */
  defaultStepSec?: number;
  /** Optional fetch implementation — overridable for tests. */
  fetchFn?: typeof fetch;
}

interface PromQueryResponseMatrix {
  status: "success";
  data: {
    resultType: "matrix";
    result: Array<{ metric: Record<string, string>; values: Array<[number, string]> }>;
  };
}

interface PromQueryResponseVector {
  status: "success";
  data: {
    resultType: "vector";
    result: Array<{ metric: Record<string, string>; value: [number, string] }>;
  };
}

interface PromQueryResponseScalar {
  status: "success";
  data: { resultType: "scalar"; result: [number, string] };
}

interface PromQueryError {
  status: "error";
  errorType: string;
  error: string;
}

export class HttpGrafanaClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HttpGrafanaClientError";
  }
}

export class HttpGrafanaClient implements GrafanaClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly defaultStepSec: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: HttpGrafanaClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.defaultStepSec = opts.defaultStepSec ?? 60;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async queryInstant(input: PromQueryInstantInput): Promise<PromQueryInstantResult> {
    const url = new URL(`${this.baseUrl}/api/v1/query`);
    url.searchParams.set("query", input.query);
    if (input.atIso) {
      url.searchParams.set("time", String(Math.floor(new Date(input.atIso).getTime() / 1000)));
    }
    const body = await this.get(url);
    if (isPromError(body)) {
      throw new HttpGrafanaClientError(`prometheus error: ${body.errorType}: ${body.error}`);
    }
    const parsed = body as PromQueryResponseVector | PromQueryResponseScalar;
    const value = extractInstantValue(parsed);
    return {
      query: input.query,
      value,
      atIso: input.atIso ?? new Date().toISOString()
    };
  }

  async queryRange(input: PromQueryRangeInput): Promise<PromQueryRangeResult> {
    const url = new URL(`${this.baseUrl}/api/v1/query_range`);
    url.searchParams.set("query", input.query);
    url.searchParams.set("start", String(Math.floor(new Date(input.fromIso).getTime() / 1000)));
    url.searchParams.set("end", String(Math.floor(new Date(input.toIso).getTime() / 1000)));
    url.searchParams.set("step", String(input.stepSec ?? this.defaultStepSec));
    const body = await this.get(url);
    if (isPromError(body)) {
      throw new HttpGrafanaClientError(`prometheus error: ${body.errorType}: ${body.error}`);
    }
    const parsed = body as PromQueryResponseMatrix;
    const firstSeries = parsed.data.result[0];
    const points = (firstSeries?.values ?? []).map(([tsSec, valueStr]) => ({
      ts: new Date(tsSec * 1000).toISOString(),
      value: parseFloat(valueStr)
    }));
    return { query: input.query, points };
  }

  private async get(url: URL): Promise<unknown> {
    const res = await this.fetchFn(url.toString(), {
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/json"
      }
    });
    if (!res.ok) {
      throw new HttpGrafanaClientError(`HTTP ${res.status} from ${url.pathname}`);
    }
    return (await res.json()) as unknown;
  }
}

function isPromError(body: unknown): body is PromQueryError {
  return (
    typeof body === "object" &&
    body !== null &&
    "status" in body &&
    (body as { status: unknown }).status === "error"
  );
}

function extractInstantValue(
  body: PromQueryResponseVector | PromQueryResponseScalar
): number {
  if (body.data.resultType === "scalar") {
    return parseFloat(body.data.result[1]);
  }
  const first = body.data.result[0];
  if (!first) throw new HttpGrafanaClientError("prometheus returned empty vector");
  return parseFloat(first.value[1]);
}
