export interface CloudflareClient {
  upsertDnsRecord(zone: string, name: string, type: string, content: string): Promise<void>;
  deleteDnsRecord(zone: string, name: string): Promise<void>;
}

export class InMemoryCloudflareClient implements CloudflareClient {
  private readonly records = new Map<string, Map<string, { type: string; content: string }>>();

  async upsertDnsRecord(zone: string, name: string, type: string, content: string): Promise<void> {
    if (!this.records.has(zone)) this.records.set(zone, new Map());
    this.records.get(zone)!.set(name, { type, content });
  }

  async deleteDnsRecord(zone: string, name: string): Promise<void> {
    this.records.get(zone)?.delete(name);
  }

  list(zone: string): Array<{ name: string; type: string; content: string }> {
    const z = this.records.get(zone);
    if (!z) return [];
    return [...z.entries()].map(([name, v]) => ({ name, type: v.type, content: v.content }));
  }
}
