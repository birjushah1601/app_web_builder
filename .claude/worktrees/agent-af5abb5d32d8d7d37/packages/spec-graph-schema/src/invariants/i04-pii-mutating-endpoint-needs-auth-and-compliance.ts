import type { SpecGraph } from "../graph.js";
import type { Invariant, ValidationIssue } from "./runner.js";

export const i04PiiMutatingEndpointNeedsAuthAndCompliance: Invariant = (graph: SpecGraph): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const [endpointId, endpoint] of Object.entries(graph.nodes)) {
    if (endpoint.kind !== "endpoint") continue;
    const mutates = graph.edges.filter((e) => e.type === "mutates" && e.from === endpointId);
    const mutatesPii = mutates.some((e) => {
      const target = graph.nodes[e.to];
      return target?.kind === "model" && target.piiClassification !== "none";
    });
    if (!mutatesPii) continue;

    const hasAuth = graph.edges.some(
      (e) => e.type === "requires" && e.from === endpointId && graph.nodes[e.to]?.kind === "authboundary"
    );
    const hasCompliance = graph.edges.some(
      (e) => e.type === "subjectTo" && e.from === endpointId && graph.nodes[e.to]?.kind === "compliance"
    );

    if (!hasAuth) {
      issues.push({
        code: "I04_PII_ENDPOINT_MISSING_AUTH",
        message: `Endpoint ${endpointId} mutates a PII Model but has no requires-edge to an AuthBoundary`,
        path: ["edges"],
        nodeId: endpointId
      });
    }
    if (!hasCompliance) {
      issues.push({
        code: "I04_PII_ENDPOINT_MISSING_COMPLIANCE",
        message: `Endpoint ${endpointId} mutates a PII Model but has no subjectTo-edge to a ComplianceClass`,
        path: ["edges"],
        nodeId: endpointId
      });
    }
  }
  return issues;
};
