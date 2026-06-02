import { z } from "zod";
import { ArtifactContractRegistry } from "./registry.js";

/**
 * Plan D.4 — artifact contract for nodes that produce a GraphQL backend.
 * Sister schema to BackendArtifactSchema (REST). The key difference is the
 * absence of a `routes` array: GraphQL exposes a single endpoint and the
 * SDL itself is the surface. Optional `operations` text lets the producing
 * role attach example documents that the cross-stack codegen can use to
 * emit typed `*Query` / `*Mutation` structures.
 */
export const BackendGraphqlArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("backend-graphql"),
  graphqlSchema: z.string().min(1),
  operations: z.string().optional(),
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

export type BackendGraphqlArtifact = z.infer<typeof BackendGraphqlArtifactSchema>;

ArtifactContractRegistry.register("backend-graphql", BackendGraphqlArtifactSchema);
