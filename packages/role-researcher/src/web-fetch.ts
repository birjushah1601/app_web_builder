import { WebFetchError } from "./errors.js";

export interface WebHit {
  title: string;
  url: string;
  description: string;
  thumbnailUrl?: string;
}

export interface WebFetchAdapter {
  search(query: string): Promise<WebHit[]>;
}

export interface BraveSearchAdapterOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  maxResults?: number;
  timeoutMs?: number;
}

export class BraveSearchAdapter implements WebFetchAdapter {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxResults: number;
  private readonly timeoutMs: number;

  constructor(opts: BraveSearchAdapterOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxResults = opts.maxResults ?? 5;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  async search(query: string): Promise<WebHit[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(this.maxResults));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey
        },
        signal: controller.signal
      });
    } catch (err) {
      throw new WebFetchError(`brave fetch failed: ${(err as Error).message}`, { provider: "brave", cause: err });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new WebFetchError(`brave returned ${res.status}`, { provider: "brave", status: res.status });
    }
    const body = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string; thumbnail?: { src?: string } }> } };
    const results = body.web?.results ?? [];
    return results.slice(0, this.maxResults).map((r) => {
      const hit: WebHit = {
        title: r.title ?? "",
        url: r.url ?? "",
        description: r.description ?? ""
      };
      if (r.thumbnail?.src) {
        hit.thumbnailUrl = r.thumbnail.src;
      }
      return hit;
    });
  }
}
