import { builder } from "./builder.js";

builder.queryType({
  fields: (t) => ({
    hello: t.string({
      description: "Smoke-test field — returns a greeting from the sandbox.",
      resolve: () => "Hello from atlas-graphql-yoga"
    })
  })
});

// Mutations and subscriptions left out of v1 — developer's diff adds them
// via builder.mutationType({ fields: (t) => ({...}) }).

export const schema = builder.toSchema();
