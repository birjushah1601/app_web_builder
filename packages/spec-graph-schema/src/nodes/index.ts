import { z } from "zod";
import type { NodeKind } from "../primitives.js";

import { PageSchema, type Page } from "./page.js";
import { RouteSchema, type Route } from "./route.js";
import { ComponentSchema, type Component } from "./component.js";
import { ClientStateSchema, type ClientState } from "./client-state.js";
import { ModelSchema, type Model } from "./model.js";
import { EndpointSchema, type Endpoint } from "./endpoint.js";
import { FlowSchema, type Flow } from "./flow.js";
import { AuthBoundarySchema, AuthBoundaryBaseSchema, type AuthBoundary } from "./auth-boundary.js";
import { TestSchema, type Test } from "./test.js";
import { DesignTokenSchema, type DesignToken } from "./design-token.js";
import { DependencySchema, type Dependency } from "./dependency.js";
import { ComplianceClassSchema, type ComplianceClass } from "./compliance-class.js";
import { AIFeatureSchema, type AIFeature } from "./ai-feature.js";
import { MediaAssetSchema, type MediaAsset } from "./media-asset.js";
import { RegionSchema, type Region } from "./region.js";
import { DataResidencySchema, type DataResidency } from "./data-residency.js";
import { RuntimeSchema, type Runtime } from "./runtime.js";
import { ProviderSchema, type Provider } from "./provider.js";
import { WorkloadTopologySchema, type WorkloadTopology } from "./workload-topology.js";

/**
 * Discriminated union of all 19 node kinds (14 core + 5 v1.1 infra).
 * AuthBoundary uses its base (non-refined) schema so the union can
 * introspect `.shape.kind`; the cross-field refinement is re-applied on
 * the union level below.
 */
export const NodeSchema = z
  .discriminatedUnion("kind", [
    PageSchema,
    RouteSchema,
    ComponentSchema,
    ClientStateSchema,
    ModelSchema,
    EndpointSchema,
    FlowSchema,
    AuthBoundaryBaseSchema,
    TestSchema,
    DesignTokenSchema,
    DependencySchema,
    ComplianceClassSchema,
    AIFeatureSchema,
    MediaAssetSchema,
    RegionSchema,
    DataResidencySchema,
    RuntimeSchema,
    ProviderSchema,
    WorkloadTopologySchema
  ])
  .superRefine((node, ctx) => {
    if (node.kind === "authboundary") {
      if (node.type === "role" && node.roles.length === 0) {
        ctx.addIssue({ code: "custom", message: "type=role requires at least one role", path: ["roles"] });
      }
      if (node.type === "permission" && node.permissions.length === 0) {
        ctx.addIssue({ code: "custom", message: "type=permission requires at least one permission", path: ["permissions"] });
      }
    }
  });

export type Node =
  | Page
  | Route
  | Component
  | ClientState
  | Model
  | Endpoint
  | Flow
  | AuthBoundary
  | Test
  | DesignToken
  | Dependency
  | ComplianceClass
  | AIFeature
  | MediaAsset
  | Region
  | DataResidency
  | Runtime
  | Provider
  | WorkloadTopology;

export const nodeRegistry = {
  page: PageSchema,
  route: RouteSchema,
  component: ComponentSchema,
  clientstate: ClientStateSchema,
  model: ModelSchema,
  endpoint: EndpointSchema,
  flow: FlowSchema,
  authboundary: AuthBoundarySchema,
  test: TestSchema,
  designtoken: DesignTokenSchema,
  dependency: DependencySchema,
  compliance: ComplianceClassSchema,
  aifeature: AIFeatureSchema,
  mediaasset: MediaAssetSchema,
  region: RegionSchema,
  dataresidency: DataResidencySchema,
  runtime: RuntimeSchema,
  provider: ProviderSchema,
  workloadtopology: WorkloadTopologySchema
} as const satisfies Record<NodeKind, z.ZodTypeAny>;

export type NodeRegistry = typeof nodeRegistry;

export {
  PageSchema, RouteSchema, ComponentSchema, ClientStateSchema, ModelSchema,
  EndpointSchema, FlowSchema, AuthBoundarySchema, AuthBoundaryBaseSchema,
  TestSchema, DesignTokenSchema, DependencySchema, ComplianceClassSchema,
  AIFeatureSchema, MediaAssetSchema,
  RegionSchema, DataResidencySchema, RuntimeSchema, ProviderSchema, WorkloadTopologySchema
};
