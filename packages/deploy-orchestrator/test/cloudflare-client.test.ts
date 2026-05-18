import { describe, it, expect } from "vitest";
import { InMemoryCloudflareClient } from "../src/cloudflare-client.js";

describe("InMemoryCloudflareClient", () => {
  it("upsertDnsRecord records the entry", async () => {
    const c = new InMemoryCloudflareClient();
    await c.upsertDnsRecord("atlas.app", "abc.atlas.app", "CNAME", "k8s-ingress.atlas.app");
    expect(c.list("atlas.app")).toEqual([
      { name: "abc.atlas.app", type: "CNAME", content: "k8s-ingress.atlas.app" }
    ]);
  });

  it("deleteDnsRecord is idempotent", async () => {
    const c = new InMemoryCloudflareClient();
    await c.upsertDnsRecord("atlas.app", "abc.atlas.app", "CNAME", "x");
    await c.deleteDnsRecord("atlas.app", "abc.atlas.app");
    await c.deleteDnsRecord("atlas.app", "abc.atlas.app");
    expect(c.list("atlas.app")).toEqual([]);
  });
});
