import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";

export const HttpMethodSchema = z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const RouteHandlerTypeSchema = z.enum(["page", "endpoint", "middleware"]);
export type RouteHandlerType = z.infer<typeof RouteHandlerTypeSchema>;

export const RouteSchema = z
  .object({
    kind: z.literal("route"),
    ...BaseNodeFields,
    pattern: z.string().min(1),
    method: HttpMethodSchema,
    handlerType: RouteHandlerTypeSchema,
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Route = z.infer<typeof RouteSchema>;
