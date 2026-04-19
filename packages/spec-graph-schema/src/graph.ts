import { z } from "zod";
import { ProjectIdSchema, ExtensionsSchema } from "./primitives.js";
import { NodeSchema } from "./nodes/index.js";
import { EdgeSchema } from "./edges/index.js";

const DatabaseProviderSchema = z
  .object({
    tier: z.enum(["atlas-run", "byo-cloud", "self-hosted"]),
    provider: z.string().min(1),
    region: z.string().min(1),
    connectionStringRef: z.string().min(1)
  })
  .strict();

const TemplateDigestSchema = z.string().regex(/^sha256:[0-9a-f]{6,64}$/, "templateDigest must be sha256:<hex>");

export const SpecGraphSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    projectId: ProjectIdSchema,
    name: z.string().min(1),
    complianceClasses: z.array(z.string().min(1)).nonempty(),
    databaseProvider: DatabaseProviderSchema,
    templateDigest: TemplateDigestSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    nodes: z.record(z.string(), NodeSchema),
    edges: z.array(EdgeSchema),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type SpecGraph = z.infer<typeof SpecGraphSchema>;
