import { describe, it, expect, vi } from "vitest";
import { HttpCloudflareClient } from "../src/http-cloudflare-client.js";
import { CloudflareApplyError } from "../src/errors.js";

type Call = { url: string; init?: RequestInit };

function makeFetch(handler: (call: Call) => { ok: boolean; status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = handler({ url, init });
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body
    };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const zoneListSuccess = {
  success: true,
  errors: [],
  result: [{ id: "zone-123", name: "atlas.app" }]
};
const recordListEmpty = { success: true, errors: [], result: [] };
const recordExists = {
  success: true,
  errors: [],
  result: [{ id: "rec-1", name: "abc.atlas.app", type: "CNAME", content: "old-target" }]
};
const successEmpty = { success: true, errors: [], result: {} };

describe("HttpCloudflareClient.upsertDnsRecord", () => {
  it("creates the record when none exists", async () => {
    const { fn, calls } = makeFetch(({ url, init }) => {
      if (url.includes("/zones?name=")) return { ok: true, body: zoneListSuccess };
      if (url.includes("/dns_records?name=")) return { ok: true, body: recordListEmpty };
      if (url.includes("/dns_records") && init?.method === "POST") return { ok: true, body: successEmpty };
      return { ok: false, body: { success: false, errors: [] } };
    });
    const c = new HttpCloudflareClient({ token: "t", fetchFn: fn });
    await c.upsertDnsRecord("atlas.app", "abc.atlas.app", "CNAME", "k8s-ingress.atlas.app");
    const post = calls.find((c) => c.init?.method === "POST");
    expect(post).toBeDefined();
    const body = JSON.parse(post!.init!.body as string);
    expect(body.name).toBe("abc.atlas.app");
    expect(body.content).toBe("k8s-ingress.atlas.app");
    expect(body.proxied).toBe(true);
  });

  it("updates the record when one already exists", async () => {
    const { fn, calls } = makeFetch(({ url, init }) => {
      if (url.includes("/zones?name=")) return { ok: true, body: zoneListSuccess };
      if (url.includes("/dns_records?name=")) return { ok: true, body: recordExists };
      if (url.includes("/dns_records/rec-1") && init?.method === "PUT")
        return { ok: true, body: successEmpty };
      return { ok: false, body: { success: false, errors: [] } };
    });
    const c = new HttpCloudflareClient({ token: "t", fetchFn: fn });
    await c.upsertDnsRecord("atlas.app", "abc.atlas.app", "CNAME", "new-target");
    const put = calls.find((c) => c.init?.method === "PUT");
    expect(put?.url).toContain("/dns_records/rec-1");
  });

  it("caches zone-id lookups across calls", async () => {
    const { fn, calls } = makeFetch(({ url, init }) => {
      if (url.includes("/zones?name=")) return { ok: true, body: zoneListSuccess };
      if (url.includes("/dns_records?name=")) return { ok: true, body: recordListEmpty };
      if (init?.method === "POST") return { ok: true, body: successEmpty };
      return { ok: false, body: { success: false, errors: [] } };
    });
    const c = new HttpCloudflareClient({ token: "t", fetchFn: fn });
    await c.upsertDnsRecord("atlas.app", "a.atlas.app", "CNAME", "x");
    await c.upsertDnsRecord("atlas.app", "b.atlas.app", "CNAME", "x");
    const zoneCalls = calls.filter((c) => c.url.includes("/zones?name="));
    expect(zoneCalls.length).toBe(1);
  });

  it("throws CloudflareApplyError when zone lookup returns empty", async () => {
    const { fn } = makeFetch(({ url }) => {
      if (url.includes("/zones?name="))
        return { ok: true, body: { success: true, errors: [], result: [] } };
      return { ok: false, body: {} };
    });
    const c = new HttpCloudflareClient({ token: "t", fetchFn: fn });
    await expect(
      c.upsertDnsRecord("missing.app", "abc.missing.app", "CNAME", "x")
    ).rejects.toThrow(/zone not found/);
  });

  it("sets Authorization: Bearer header", async () => {
    const { fn, calls } = makeFetch(({ url, init }) => {
      if (url.includes("/zones?name=")) return { ok: true, body: zoneListSuccess };
      if (url.includes("/dns_records?name=")) return { ok: true, body: recordListEmpty };
      if (init?.method === "POST") return { ok: true, body: successEmpty };
      return { ok: false, body: {} };
    });
    const c = new HttpCloudflareClient({ token: "tok-xyz", fetchFn: fn });
    await c.upsertDnsRecord("atlas.app", "abc.atlas.app", "CNAME", "x");
    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer tok-xyz");
  });

  it("throws CloudflareApplyError on non-success response body", async () => {
    const { fn } = makeFetch(({ url }) => {
      if (url.includes("/zones?name="))
        return {
          ok: true,
          body: {
            success: false,
            errors: [{ code: 9103, message: "Unknown X-Auth-Key or X-Auth-Email" }],
            result: []
          }
        };
      return { ok: false, body: {} };
    });
    const c = new HttpCloudflareClient({ token: "bad", fetchFn: fn });
    await expect(c.upsertDnsRecord("atlas.app", "x", "CNAME", "y")).rejects.toThrow(CloudflareApplyError);
  });
});

describe("HttpCloudflareClient.deleteDnsRecord", () => {
  it("issues DELETE when record exists", async () => {
    const { fn, calls } = makeFetch(({ url, init }) => {
      if (url.includes("/zones?name=")) return { ok: true, body: zoneListSuccess };
      if (url.includes("/dns_records?name=")) return { ok: true, body: recordExists };
      if (url.includes("/dns_records/rec-1") && init?.method === "DELETE")
        return { ok: true, body: successEmpty };
      return { ok: false, body: {} };
    });
    const c = new HttpCloudflareClient({ token: "t", fetchFn: fn });
    await c.deleteDnsRecord("atlas.app", "abc.atlas.app");
    const del = calls.find((c) => c.init?.method === "DELETE");
    expect(del?.url).toContain("/dns_records/rec-1");
  });

  it("is a no-op when record does not exist", async () => {
    const { fn, calls } = makeFetch(({ url }) => {
      if (url.includes("/zones?name=")) return { ok: true, body: zoneListSuccess };
      if (url.includes("/dns_records?name=")) return { ok: true, body: recordListEmpty };
      return { ok: false, body: {} };
    });
    const c = new HttpCloudflareClient({ token: "t", fetchFn: fn });
    await c.deleteDnsRecord("atlas.app", "abc.atlas.app");
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
  });
});
