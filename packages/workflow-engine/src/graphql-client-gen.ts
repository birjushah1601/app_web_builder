// Plan D.4 Task 2 — pure helper that converts a GraphQL SDL (and an optional
// raw operations document) into a TypeScript file under `lib/`. Companion to
// generateApiClient (D.2/D.3) for REST → openapi-typescript. The cross-stack
// block in makeLaunchRitual picks the right generator per upstream artifact
// kind and concatenates results into priorArtifact.generatedFiles.
//
// Pure — no filesystem access, no LLM. Throws on invalid SDL.

import { parse } from "graphql";
import { codegen } from "@graphql-codegen/core";
// The plugin packages don't ship .d.ts files; we treat them as opaque modules
// that satisfy the @graphql-codegen/core `pluginMap` shape.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no shipped type declarations
import * as typescriptPlugin from "@graphql-codegen/typescript";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no shipped type declarations
import * as typescriptOperationsPlugin from "@graphql-codegen/typescript-operations";

import type { GeneratedClient } from "./api-client-gen.js";

export type { GeneratedClient };

export interface GenerateGraphqlClientOptions {
  /**
   * Optional filename for multi-backend cross-stack. Returned path is always
   * `lib/${fileName}`. Defaults to `"graphql-client.ts"` so callers without
   * the option get a canonical single-backend path (mirrors generateApiClient's
   * `api-client.ts` default).
   */
  fileName?: string;

  /**
   * Optional raw GraphQL document text containing one or more named
   * operations. When provided, the `@graphql-codegen/typescript-operations`
   * plugin is also run so the emitted file includes typed
   * `*Query` / `*Mutation` / `*QueryVariables` etc. structures. When omitted,
   * only the `typescript` plugin's schema-derived output is emitted.
   */
  operations?: string;
}

/**
 * Generates a TypeScript GraphQL client (types) from an SDL string + optional
 * operations document via `@graphql-codegen/typescript` (always) +
 * `@graphql-codegen/typescript-operations` (only when operations are
 * provided). Returns the file path (under `lib/`) + the rendered TypeScript
 * source.
 *
 * Pure — no I/O, no LLM. Throws if the SDL fails to parse or build into a
 * GraphQLSchema.
 */
export async function generateGraphqlClient(
  graphqlSchema: string,
  opts: GenerateGraphqlClientOptions = {}
): Promise<GeneratedClient> {
  const fileName = opts.fileName ?? "graphql-client.ts";
  const filename = `lib/${fileName}`;

  // Validate + load the SDL by parsing to a DocumentNode. `parse` throws on
  // syntactically invalid SDL — the throw is propagated unchanged (the unit
  // test asserts on it). We deliberately do NOT call `buildSchema` here: when
  // CJS plugins resolve a different "graphql" module instance from our ESM
  // import, instanceof checks fail with "from another module or realm". By
  // handing codegen the raw DocumentNode (no schemaAst), codegen builds the
  // GraphQLSchema internally via @graphql-tools/schema using a single
  // consistent graphql module instance.
  const schemaDocument = parse(graphqlSchema);

  // The `documents` array is what typescript-operations consumes. The
  // `typescript` plugin ignores it. Pre-validate the operations text by
  // running `parse()` — that way an invalid operations document also throws
  // immediately rather than yielding a confusing codegen error.
  const documents = opts.operations
    ? [{ location: "operations.graphql", document: parse(opts.operations) }]
    : [];

  // Always run the typescript plugin (schema-derived types).
  const plugins: Array<Record<string, Record<string, unknown>>> = [
    { typescript: {} }
  ];
  const pluginMap: Record<string, unknown> = {
    typescript: typescriptPlugin
  };

  // Conditionally run typescript-operations when callers passed an operations
  // document. Plugin output is concatenated by @graphql-codegen/core.
  if (opts.operations) {
    plugins.push({ "typescript-operations": {} });
    pluginMap["typescript-operations"] = typescriptOperationsPlugin;
  }

  const contents = await codegen({
    filename,
    schema: schemaDocument,
    documents,
    config: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugins: plugins as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pluginMap: pluginMap as any
  });

  return { path: filename, contents };
}
