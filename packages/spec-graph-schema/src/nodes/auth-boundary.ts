import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const AuthBoundaryTypeSchema = z.enum(["public", "authenticated", "role", "permission"]);
export type AuthBoundaryType = z.infer<typeof AuthBoundaryTypeSchema>;

/**
 * Plain ZodObject form of AuthBoundary, without the cross-field refinement.
 * Exported so `z.discriminatedUnion("kind", [..., AuthBoundaryBaseSchema, ...])`
 * in nodes/index.ts can introspect `.shape.kind`. The refined version
 * `AuthBoundarySchema` is what standalone consumers import.
 */
export const AuthBoundaryBaseSchema = z
  .object({
    kind: z.literal("authboundary"),
    ...BaseNodeFields,
    name: z.string().min(1),
    type: AuthBoundaryTypeSchema,
    roles: z.array(z.string().min(1)).default([]),
    permissions: z.array(z.string().min(1)).default([]),
    bypassConditions: z.array(z.string().min(1)).default([]),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export const AuthBoundarySchema = AuthBoundaryBaseSchema.superRefine((node, ctx) => {
  if (node.type === "role" && node.roles.length === 0) {
    ctx.addIssue({ code: "custom", message: "type=role requires at least one role", path: ["roles"] });
  }
  if (node.type === "permission" && node.permissions.length === 0) {
    ctx.addIssue({ code: "custom", message: "type=permission requires at least one permission", path: ["permissions"] });
  }
});

export type AuthBoundary = z.infer<typeof AuthBoundarySchema>;
