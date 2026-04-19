import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema, PiiClassificationSchema } from "../primitives.js";

export const ClientStateKindSchema = z.enum([
  "context",
  "zustand-store",
  "reducer",
  "query-cache",
  "form-state",
  "route-state"
]);
export type ClientStateKind = z.infer<typeof ClientStateKindSchema>;

export const ClientStatePersistenceSchema = z.enum(["none", "sessionStorage", "localStorage", "url"]);
export type ClientStatePersistence = z.infer<typeof ClientStatePersistenceSchema>;

export const ClientStateScopeSchema = z.enum(["page", "layout", "app", "flow"]);
export type ClientStateScope = z.infer<typeof ClientStateScopeSchema>;

export const ClientStateSchema = z
  .object({
    kind: z.literal("clientstate"),
    ...BaseNodeFields,
    name: z.string().min(1),
    stateKind: ClientStateKindSchema,
    schema: z.record(z.string(), z.unknown()).optional(),
    persistence: ClientStatePersistenceSchema,
    scope: ClientStateScopeSchema,
    piiClassification: PiiClassificationSchema.default("none"),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type ClientState = z.infer<typeof ClientStateSchema>;
