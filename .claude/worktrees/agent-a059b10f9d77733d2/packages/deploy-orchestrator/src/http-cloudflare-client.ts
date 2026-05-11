import { CloudflareApplyError } from "./errors.js";
import type { CloudflareClient } from "./cloudflare-client.js";

export interface HttpCloudflareClientOptions {
  /** Cloudflare API bearer token. */
  token: string;
  /** Optional base URL override — defaults to https://api.cloudflare.com/client/v4. */
  baseUrl?: string;
  /** Injectable fetch implementation for tests. */
  fetchFn?: typeof fetch;
}

interface CfResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
}

interface CfZone {
  id: string;
  name: string;
}

interface CfDnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
}

export class HttpCloudflareClient implements CloudflareClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly zoneIdCache = new Map<string, string>();

  constructor(opts: HttpCloudflareClientOptions) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async upsertDnsRecord(zone: string, name: string, type: string, content: string): Promise<void> {
    const zoneId = await this.resolveZoneId(zone);
    const existing = await this.findRecord(zoneId, name);
    if (existing) {
      await this.apiCall<CfDnsRecord>(
        `/zones/${zoneId}/dns_records/${existing.id}`,
        "PUT",
        { type, name, content, ttl: 1, proxied: true }
      );
    } else {
      await this.apiCall<CfDnsRecord>(
        `/zones/${zoneId}/dns_records`,
        "POST",
        { type, name, content, ttl: 1, proxied: true }
      );
    }
  }

  async deleteDnsRecord(zone: string, name: string): Promise<void> {
    const zoneId = await this.resolveZoneId(zone);
    const existing = await this.findRecord(zoneId, name);
    if (!existing) return; // idempotent
    await this.apiCall<CfDnsRecord>(
      `/zones/${zoneId}/dns_records/${existing.id}`,
      "DELETE"
    );
  }

  private async resolveZoneId(zone: string): Promise<string> {
    const cached = this.zoneIdCache.get(zone);
    if (cached) return cached;
    const zones = await this.apiCall<CfZone[]>(`/zones?name=${encodeURIComponent(zone)}`, "GET");
    const match = zones.find((z) => z.name === zone);
    if (!match) {
      throw new CloudflareApplyError(`Cloudflare zone not found: "${zone}"`);
    }
    this.zoneIdCache.set(zone, match.id);
    return match.id;
  }

  private async findRecord(zoneId: string, name: string): Promise<CfDnsRecord | null> {
    const records = await this.apiCall<CfDnsRecord[]>(
      `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`,
      "GET"
    );
    return records[0] ?? null;
  }

  private async apiCall<T>(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    body?: unknown
  ): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      throw new CloudflareApplyError(`Cloudflare API ${method} ${path} returned HTTP ${res.status}`);
    }
    const parsed = (await res.json()) as CfResponse<T>;
    if (!parsed.success) {
      const msg = parsed.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
      throw new CloudflareApplyError(`Cloudflare API error on ${method} ${path}: ${msg}`);
    }
    return parsed.result;
  }
}
