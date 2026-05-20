import { z } from "zod";

export const NODE_KINDS = [
  "page",
  "route",
  "component",
  "clientstate",
  "model",
  "endpoint",
  "flow",
  "authboundary",
  "test",
  "designtoken",
  "dependency",
  "compliance",
  "aifeature",
  "mediaasset",
  "region",
  "dataresidency",
  "runtime",
  "provider",
  "workloadtopology"
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export const NodeKindSchema = z.enum(NODE_KINDS);

export const ProjectIdSchema = z.string().uuid();
export type ProjectId = z.infer<typeof ProjectIdSchema>;

const NODE_ID_RE = new RegExp(`^(${NODE_KINDS.join("|")}):[A-Za-z0-9._-]+$`);

export const NodeIdSchema = z
  .string()
  .regex(NODE_ID_RE, "NodeId must be <kind>:<id> with a known kind and a non-empty id segment");
export type NodeId = z.infer<typeof NodeIdSchema>;

export const EdgeIdSchema = z.string().min(1);
export type EdgeId = z.infer<typeof EdgeIdSchema>;

export const PiiClassificationSchema = z.enum(["none", "indirect", "direct", "sensitive"]);
export type PiiClassification = z.infer<typeof PiiClassificationSchema>;

export const ExtensionsSchema = z.record(z.string(), z.unknown()).default({});
export type Extensions = z.infer<typeof ExtensionsSchema>;

export function parseNodeKindFromId(id: string): NodeKind {
  const colon = id.indexOf(":");
  if (colon < 0) throw new Error(`parseNodeKindFromId: missing colon in "${id}"`);
  const kind = id.slice(0, colon);
  const valid = NODE_KINDS.includes(kind as NodeKind);
  if (!valid) throw new Error(`parseNodeKindFromId: unknown kind "${kind}" in "${id}"`);
  return kind as NodeKind;
}

/** Common shape every node mixes in. */
export const BaseNodeFields = {
  id: NodeIdSchema,
  extensions: ExtensionsSchema.optional()
} as const;
