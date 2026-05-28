import { z } from "zod";
import { ArtifactContractRegistry } from "./registry.js";

export const BackendArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("backend-rest-api"),
  openApiSpec: z.record(z.unknown()),
  routes: z.array(
    z.object({
      method: z.enum(["get", "post", "put", "patch", "delete", "head", "options"]),
      path: z.string().min(1),
      opId: z.string().optional(),
      requestSchema: z.record(z.unknown()).optional(),
      responseSchema: z.record(z.unknown()).optional()
    })
  ),
  dbDdl: z.string().optional(),
  envContract: z.array(
    z.object({
      name: z.string().min(1),
      required: z.boolean(),
      description: z.string().optional()
    })
  ),
  sandboxId: z.string().min(1),
  previewUrl: z.string().url().optional()
});

export type BackendArtifact = z.infer<typeof BackendArtifactSchema>;

ArtifactContractRegistry.register("backend-rest-api", BackendArtifactSchema);
