import { z } from "zod";
import { validateReferences } from "./validate-references.js";

export const PostgresTypeSchema = z.string().min(1);
export type PostgresType = z.infer<typeof PostgresTypeSchema>;

export const FieldReferenceSchema = z.object({
  entity: z.string().min(1),
  field: z.string().min(1),
  onDelete: z.enum(["cascade", "set null", "restrict", "no action"]),
  onUpdate: z.enum(["cascade", "set null", "restrict", "no action"]).optional()
});

export const FieldSchema = z.object({
  name: z.string().min(1),
  type: PostgresTypeSchema,
  nullable: z.boolean(),
  default: z.string().optional(),
  references: FieldReferenceSchema.optional(),
  generated: z
    .object({
      as: z.string().min(1),
      stored: z.boolean()
    })
    .optional(),
  description: z.string().optional()
});
export type Field = z.infer<typeof FieldSchema>;

export const IndexSchema = z.object({
  name: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1),
  unique: z.boolean().optional(),
  where: z.string().optional(),
  method: z.enum(["btree", "gin", "gist", "hash"]).optional()
});
export type Index = z.infer<typeof IndexSchema>;

export const ConstraintSchema = z.object({
  type: z.enum(["check", "unique", "exclude"]),
  name: z.string().min(1),
  expression: z.string().min(1)
});
export type Constraint = z.infer<typeof ConstraintSchema>;

export const RlsPolicySchema = z.object({
  name: z.string().min(1),
  applyTo: z.enum(["select", "insert", "update", "delete", "all"]),
  using: z.string().min(1).optional(),
  withCheck: z.string().optional(),
  role: z.string().optional()
});
export type RlsPolicy = z.infer<typeof RlsPolicySchema>;

export const RlsConfigSchema = z.object({
  enabled: z.boolean(),
  policies: z.array(RlsPolicySchema)
});
export type RlsConfig = z.infer<typeof RlsConfigSchema>;

export const AuditConfigSchema = z.object({
  createdAt: z.boolean(),
  updatedAt: z.boolean(),
  createdBy: z.boolean().optional(),
  deletedAt: z.boolean().optional()
});
export type AuditConfig = z.infer<typeof AuditConfigSchema>;

export const PrimaryKeySchema = z.object({
  columns: z.array(z.string().min(1)).min(1),
  strategy: z.enum(["uuid", "serial", "composite"])
});
export type PrimaryKey = z.infer<typeof PrimaryKeySchema>;

export const PartitioningSchema = z.object({
  kind: z.enum(["range", "list", "hash"]),
  on: z.string().min(1)
});
export type Partitioning = z.infer<typeof PartitioningSchema>;

export const EntitySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  fields: z.array(FieldSchema).min(1),
  primaryKey: PrimaryKeySchema,
  indexes: z.array(IndexSchema),
  constraints: z.array(ConstraintSchema),
  rls: RlsConfigSchema,
  audit: AuditConfigSchema,
  partitioning: PartitioningSchema.optional(),
  migrationHints: z.array(z.string().min(1)),
  notes: z.string().optional()
});
export type Entity = z.infer<typeof EntitySchema>;

export const DataModelSchema = z.object({
  entities: z.array(EntitySchema).min(1)
});
export type DataModel = z.infer<typeof DataModelSchema>;

export const RestOperationSchema = z.object({
  method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
  path: z.string().min(1),
  summary: z.string().min(1),
  requestSchema: z.object({ fields: z.array(FieldSchema) }).optional(),
  responseSchema: z.object({ fields: z.array(FieldSchema) }).optional(),
  statusCodes: z.array(z.number().int()).min(1)
});
export type RestOperation = z.infer<typeof RestOperationSchema>;

export const GraphqlOperationSchema = z.object({
  kind: z.enum(["query", "mutation", "subscription"]),
  name: z.string().min(1),
  summary: z.string().min(1),
  args: z.array(FieldSchema),
  returnType: z.string().min(1)
});
export type GraphqlOperation = z.infer<typeof GraphqlOperationSchema>;

export const ContractSchema = z.discriminatedUnion("style", [
  z.object({ style: z.literal("rest"), operations: z.array(RestOperationSchema) }),
  z.object({ style: z.literal("graphql"), operations: z.array(GraphqlOperationSchema) })
]);
export type Contract = z.infer<typeof ContractSchema>;

export const SchemaDirectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortDescription: z.string().min(1),
  technicalDescription: z.string().min(1),
  contract: ContractSchema,
  dataModel: DataModelSchema
});
export type SchemaDirection = z.infer<typeof SchemaDirectionSchema>;

export const SchemaProposalSchema = z
  .object({
    recommended: SchemaDirectionSchema,
    alternates: z.tuple([SchemaDirectionSchema, SchemaDirectionSchema]),
    reasoning: z.string().min(1)
  })
  .superRefine((proposal, ctx) => {
    const directions: Array<{ path: ReadonlyArray<string | number>; direction: typeof proposal.recommended }> = [
      { path: ["recommended"], direction: proposal.recommended },
      { path: ["alternates", 0], direction: proposal.alternates[0] },
      { path: ["alternates", 1], direction: proposal.alternates[1] }
    ];
    for (const { path, direction } of directions) {
      const r = validateReferences(direction.dataModel);
      if (!r.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${r.reason}: ${r.message}`,
          path: [...path, "dataModel"]
        });
      }
    }
  });
export type SchemaProposal = z.infer<typeof SchemaProposalSchema>;
