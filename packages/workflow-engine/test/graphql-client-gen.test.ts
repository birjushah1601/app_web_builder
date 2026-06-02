// test/graphql-client-gen.test.ts
// Plan D.4 Task 2 — pure helper that converts a GraphQL SDL (and optionally a
// raw operations document) into a TypeScript file under lib/. Mirrors the
// shape + invariants of generateApiClient (D.2/D.3) so cross-stack injection
// can interchangeably emit REST or GraphQL clients.
import { describe, it, expect } from "vitest";
import { generateGraphqlClient } from "../src/graphql-client-gen.js";

const SIMPLE_SDL = /* GraphQL */ `
  type Query {
    health: String!
    user(id: ID!): User
  }

  type User {
    id: ID!
    name: String!
    email: String
  }
`;

const SIMPLE_OPS = /* GraphQL */ `
  query GetHealth {
    health
  }

  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
    }
  }
`;

describe("generateGraphqlClient", () => {
  it("returns the canonical lib/graphql-client.ts path by default", async () => {
    const r = await generateGraphqlClient(SIMPLE_SDL);
    expect(r.path).toBe("lib/graphql-client.ts");
  });

  it("emits TypeScript types derived from the SDL", async () => {
    const r = await generateGraphqlClient(SIMPLE_SDL);
    // The @graphql-codegen/typescript plugin always emits a `Scalars` block +
    // one `export type X` per SDL type. Asserting on these keeps the test
    // resilient to plugin formatting tweaks.
    expect(r.contents).toMatch(/export\s+type/);
    expect(r.contents).toMatch(/User/);
  });

  it("accepts an optional fileName and uses it for the returned path", async () => {
    const r = await generateGraphqlClient(SIMPLE_SDL, {
      fileName: "graphql-client-gql-x.ts"
    });
    expect(r.path).toBe("lib/graphql-client-gql-x.ts");
    expect(r.contents).toMatch(/export\s+type/);
  });

  it("throws on invalid GraphQL SDL", async () => {
    await expect(
      generateGraphqlClient("this is not graphql {{{")
    ).rejects.toThrow();
  });

  it("includes operation types when operations are provided", async () => {
    const r = await generateGraphqlClient(SIMPLE_SDL, { operations: SIMPLE_OPS });
    // typescript-operations emits one `*Query` / `*QueryVariables` per
    // operation. The names come from the operation names in the document.
    expect(r.contents).toMatch(/GetHealthQuery/);
    expect(r.contents).toMatch(/GetUserQuery/);
    expect(r.contents).toMatch(/GetUserQueryVariables/);
  });
});
