import { z } from "zod";
import { ArtifactContractRegistry } from "./registry.js";

const ArgoApplicationSchema = z.object({
  file: z.string().min(1),
  content: z.string(),
  name: z.string().min(1),
  repoUrl: z.string().min(1),
  path: z.string().min(1)
});

const ImageBuildSchema = z.object({
  serviceName: z.string().min(1),
  dockerfilePath: z.string().min(1),
  imageTag: z.string().min(1)
});

const SmokeTestSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["get", "post", "put", "patch", "delete", "head"]).optional(),
  expectStatus: z.number().int().min(100).max(599),
  expectBodyContains: z.string().optional()
});

export const DeployArtifactSchema = z.object({
  schemaVersion: z.literal("1"),
  kind: z.literal("deploy"),
  target: z.literal("k8s"),
  argoApplication: ArgoApplicationSchema,
  imageBuilds: z.array(ImageBuildSchema),
  smokeTests: z.array(SmokeTestSchema)
});

export type DeployArtifact = z.infer<typeof DeployArtifactSchema>;
export type DeployArgoApplication = z.infer<typeof ArgoApplicationSchema>;
export type DeployImageBuild = z.infer<typeof ImageBuildSchema>;
export type DeploySmokeTest = z.infer<typeof SmokeTestSchema>;

ArtifactContractRegistry.register("deploy", DeployArtifactSchema);
