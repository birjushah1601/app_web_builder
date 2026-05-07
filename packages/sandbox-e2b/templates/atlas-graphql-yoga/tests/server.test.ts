import { describe, it, expect, beforeAll, afterAll } from "bun:test";

let server: ReturnType<typeof Bun.serve> | undefined;

beforeAll(async () => {
  // Import lazily so tests can survive missing src/server.ts during red phase.
  const { createServer } = await import("../src/server.js");
  server = createServer({ port: 0 }); // 0 = OS-assigned port
});

afterAll(() => {
  server?.stop(true);
});

describe("atlas-graphql-yoga server", () => {
  it("GET /health returns ok JSON", async () => {
    const url = `http://localhost:${server!.port}/health`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: "ok",
      stack: "graphql-yoga",
      atlas: "sandbox-ready"
    });
  });

  it("GET / returns app metadata", async () => {
    const url = `http://localhost:${server!.port}/`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Atlas Sandbox");
    expect(body.version).toBe("0.1.0");
    expect(body.graphqlEndpoint).toBe("/graphql");
  });

  it("POST /graphql with { hello } query returns the expected string", async () => {
    const url = `http://localhost:${server!.port}/graphql`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ hello }" })
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toBeUndefined();
    expect(body.data).toEqual({ hello: "Hello from atlas-graphql-yoga" });
  });

  it("GET /graphql returns the GraphiQL UI in dev", async () => {
    const url = `http://localhost:${server!.port}/graphql`;
    const res = await fetch(url, { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.toLowerCase()).toContain("graphiql");
  });
});
