import type { BackendArtifact } from "@atlas/workflow-engine";

const HTTP_METHODS = new Set([
  "get", "post", "put", "patch", "delete", "head", "options"
] as const);

export interface BuildBackendArtifactInput {
  openApiSpec: Record<string, unknown>;
  envContract: BackendArtifact["envContract"];
  sandboxId: string;
  previewUrl?: string;
  dbDdl?: string;
}

export function buildBackendArtifact(input: BuildBackendArtifactInput): BackendArtifact {
  const routes: BackendArtifact["routes"] = [];
  const paths = (input.openApiSpec.paths ?? {}) as Record<string, unknown>;
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const [maybeMethod, op] of Object.entries(item as Record<string, unknown>)) {
      const method = maybeMethod.toLowerCase();
      if (!HTTP_METHODS.has(method as never)) continue;
      const opObj = (op ?? {}) as {
        operationId?: unknown;
        requestBody?: { content?: Record<string, { schema?: unknown }> };
        responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
      };
      const requestSchema = pickJsonSchema(opObj.requestBody?.content);
      const successResponse = Object.entries(opObj.responses ?? {})
        .find(([code]) => code.startsWith("2"))?.[1];
      const responseSchema = pickJsonSchema(successResponse?.content);
      routes.push({
        method: method as BackendArtifact["routes"][number]["method"],
        path,
        ...(typeof opObj.operationId === "string" && { opId: opObj.operationId }),
        ...(requestSchema && { requestSchema }),
        ...(responseSchema && { responseSchema })
      });
    }
  }

  return {
    schemaVersion: "1",
    kind: "backend-rest-api",
    openApiSpec: input.openApiSpec,
    routes,
    envContract: input.envContract,
    sandboxId: input.sandboxId,
    ...(input.previewUrl && { previewUrl: input.previewUrl }),
    ...(input.dbDdl && { dbDdl: input.dbDdl })
  };
}

function pickJsonSchema(
  content: Record<string, { schema?: unknown }> | undefined
): Record<string, unknown> | undefined {
  if (!content) return undefined;
  const json = content["application/json"]?.schema;
  if (!json || typeof json !== "object") return undefined;
  return json as Record<string, unknown>;
}
