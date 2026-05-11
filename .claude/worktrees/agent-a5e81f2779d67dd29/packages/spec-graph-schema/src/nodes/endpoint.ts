import { z } from "zod";
import { BaseNodeFields, ExtensionsSchema } from "../primitives.js";
import { HttpMethodSchema } from "./route.js";

const DurationSchema = z
  .string()
  .regex(/^[1-9][0-9]*(ms|s|m|h|d)$/, "duration must look like 1s, 250ms, 5m, 1h, 7d");

export const RateLimitSchema = z
  .object({
    window: DurationSchema,
    max: z.number().int().positive()
  })
  .strict();
export type RateLimit = z.infer<typeof RateLimitSchema>;

export const EndpointSchema = z
  .object({
    kind: z.literal("endpoint"),
    ...BaseNodeFields,
    name: z.string().min(1),
    routeRef: z.string().min(1),
    method: HttpMethodSchema,
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    authRef: z.string().optional(),
    rateLimit: RateLimitSchema.optional(),
    extensions: ExtensionsSchema.optional()
  })
  .strict();

export type Endpoint = z.infer<typeof EndpointSchema>;
