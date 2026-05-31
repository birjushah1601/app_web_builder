import openapiTS, { astToString } from "openapi-typescript";

export interface GeneratedClient {
  path: string;
  contents: string;
}

/**
 * Generates a TypeScript API client from an OpenAPI 3.x spec object via
 * the openapi-typescript library. Returns the canonical file path
 * (lib/api-client.ts) + the rendered TypeScript source.
 *
 * Pure — no I/O, no LLM. Throws if the input is not a valid OpenAPI doc.
 */
export async function generateApiClient(openApiSpec: unknown): Promise<GeneratedClient> {
  const ast = await openapiTS(openApiSpec as never);
  const contents = astToString(ast);
  return { path: "lib/api-client.ts", contents };
}
