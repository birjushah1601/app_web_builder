import { z } from "zod";
import { ArtifactContractRegistry } from "./registry.js";

const K8sManifestSchema = z.object({
  file: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  content: z.string()
});

const ServiceSchema = z.object({
  name: z.string().min(1),
  runtimeNodeId: z.string().min(1),
  artifactKind: z.string().min(1),
  port: z.number().int().positive().optional(),
  envContract: z.array(z.object({
    name: z.string().min(1),
    required: z.boolean(),
    description: z.string().optional()
  }))
});

export const IacArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("iac"),
  compose: z.object({
    file: z.string().min(1),
    content: z.string()
  }),
  k8s: z.object({
    manifests: z.array(K8sManifestSchema)
  }),
  services: z.array(ServiceSchema),
  imageRegistry: z.object({
    url: z.string().min(1),
    namespace: z.string().min(1)
  })
});

export type IacArtifact = z.infer<typeof IacArtifactSchema>;
export type IacService = z.infer<typeof ServiceSchema>;
export type IacK8sManifest = z.infer<typeof K8sManifestSchema>;

ArtifactContractRegistry.register("iac", IacArtifactSchema);
