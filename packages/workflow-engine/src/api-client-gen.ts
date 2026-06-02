import openapiTS, { astToString } from "openapi-typescript";

export interface GeneratedClient {
  path: string;
  contents: string;
}

export interface GenerateApiClientOptions {
  /**
   * Plan D.3 — optional filename for multi-backend cross-stack. The returned
   * path is always `lib/${fileName}`. When omitted, defaults to
   * `"api-client.ts"` so callers receive the canonical Plan D.2
   * `lib/api-client.ts` path (single-backend backward compatibility).
   */
  fileName?: string;
}

/**
 * Generates a TypeScript API client from an OpenAPI 3.x spec object via
 * the openapi-typescript library. Returns the file path (under `lib/`)
 * + the rendered TypeScript source.
 *
 * - Plan D.2 (single-backend): call without opts → `lib/api-client.ts`.
 * - Plan D.3 (multi-backend): pass `{ fileName: "api-client-{nodeId}.ts" }`
 *   so each upstream backend gets its own file.
 *
 * Pure — no I/O, no LLM. Throws if the input is not a valid OpenAPI doc.
 */
export async function generateApiClient(
  openApiSpec: unknown,
  opts: GenerateApiClientOptions = {}
): Promise<GeneratedClient> {
  const ast = await openapiTS(openApiSpec as never);
  const contents = astToString(ast);
  const fileName = opts.fileName ?? "api-client.ts";
  return { path: `lib/${fileName}`, contents };
}
