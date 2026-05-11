export interface PromQueryRangeInput {
  query: string;
  fromIso: string;
  toIso: string;
  /** Step in seconds. */
  stepSec?: number;
}

export interface PromQueryRangeResult {
  query: string;
  points: Array<{ ts: string; value: number }>;
}

export interface PromQueryInstantInput {
  query: string;
  atIso?: string;
}

export interface PromQueryInstantResult {
  query: string;
  value: number;
  atIso: string;
}

export interface GrafanaClient {
  queryRange(input: PromQueryRangeInput): Promise<PromQueryRangeResult>;
  queryInstant(input: PromQueryInstantInput): Promise<PromQueryInstantResult>;
}

export class InMemoryGrafanaClient implements GrafanaClient {
  private readonly ranges = new Map<string, Array<{ ts: string; value: number }>>();
  private readonly instants = new Map<string, number>();

  preloadRange(query: string, points: Array<{ ts: string; value: number }>): void {
    this.ranges.set(query, points);
  }

  preloadInstant(query: string, value: number): void {
    this.instants.set(query, value);
  }

  async queryRange(input: PromQueryRangeInput): Promise<PromQueryRangeResult> {
    const points = this.ranges.get(input.query);
    if (!points) throw new Error(`InMemoryGrafanaClient: no range data for query "${input.query}"`);
    return { query: input.query, points };
  }

  async queryInstant(input: PromQueryInstantInput): Promise<PromQueryInstantResult> {
    if (!this.instants.has(input.query)) {
      throw new Error(`InMemoryGrafanaClient: no instant data for query "${input.query}"`);
    }
    return {
      query: input.query,
      value: this.instants.get(input.query)!,
      atIso: input.atIso ?? new Date().toISOString()
    };
  }
}
