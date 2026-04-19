export { validate, ALL_INVARIANTS } from "./validate.js";
export type { GraphValidator, ValidationResult, ValidationIssue, Invariant } from "./validate.js";

export { SpecGraphSchema } from "./graph.js";
export type { SpecGraph } from "./graph.js";

export { NodeSchema, nodeRegistry } from "./nodes/index.js";
export type { Node, NodeRegistry } from "./nodes/index.js";

export { EdgeSchema, edgeRegistry, EDGE_TYPES } from "./edges/index.js";
export type { Edge, EdgeRegistry, EdgeType } from "./edges/index.js";

export {
  NODE_KINDS, NodeKindSchema, ProjectIdSchema, NodeIdSchema, EdgeIdSchema,
  PiiClassificationSchema, ExtensionsSchema, parseNodeKindFromId
} from "./primitives.js";
export type { NodeKind, ProjectId, NodeId, EdgeId, PiiClassification } from "./primitives.js";

// Per-node-type schemas (re-exported for granular consumers)
export {
  PageSchema, RouteSchema, ComponentSchema, ClientStateSchema, ModelSchema,
  EndpointSchema, FlowSchema, AuthBoundarySchema, TestSchema, DesignTokenSchema,
  DependencySchema, ComplianceClassSchema, AIFeatureSchema, MediaAssetSchema
} from "./nodes/index.js";
