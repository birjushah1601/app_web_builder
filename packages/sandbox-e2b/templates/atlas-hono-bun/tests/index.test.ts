import { describe, it, expect } from "bun:test";
import app from "../src/index.ts";

describe("atlas-hono-bun smoke", () => {
  it("GET /health returns 200 with stack metadata", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.stack).toBe("hono-bun");
    expect(body.atlas).toBe("sandbox-ready");
  });

  it("GET / returns 200 with app metadata", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Atlas Sandbox");
    expect(body.version).toBe("0.1.0");
  });

  it("404s for unknown routes", async () => {
    const res = await app.request("/this-route-does-not-exist");
    expect(res.status).toBe(404);
  });
});
