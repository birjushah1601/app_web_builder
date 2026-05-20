import type { EditClass } from "./types.js";
export type { EditClass };

const SC_TOUCH: EditClass = "security-compliance-touching";
const STR: EditClass = "structural";
const COS: EditClass = "cosmetic";

function startsWith(fieldPath: string, prefix: string): boolean {
  return fieldPath === prefix || fieldPath.startsWith(prefix + ".") || fieldPath.startsWith(prefix + "[");
}

export function rateField(nodeId: string, fieldPath: string, kind: string): EditClass {
  // Always-security-compliance-touching node kinds
  if (kind === "authboundary") return SC_TOUCH;
  if (kind === "compliance") return SC_TOUCH;

  // Field-specific within Model
  if (kind === "model") {
    if (startsWith(fieldPath, "rlsPolicies")) return SC_TOUCH;
    if (startsWith(fieldPath, "piiFields")) return SC_TOUCH;
  }

  // Root-level
  if (nodeId === "$root") {
    if (startsWith(fieldPath, "complianceClasses")) return SC_TOUCH;
    return STR; // every other root field change is structural
  }

  // Page
  if (kind === "page") {
    if (fieldPath === "title" || startsWith(fieldPath, "copy")) return COS;
    if (["path", "routeRef", "renderMode", "authRequired"].includes(fieldPath)) return STR;
  }

  // Route
  if (kind === "route") {
    if (["method", "path", "handlerType"].includes(fieldPath)) return STR;
  }

  // Endpoint
  if (kind === "endpoint") {
    if (["method", "path"].includes(fieldPath) || startsWith(fieldPath, "inputs") || startsWith(fieldPath, "outputs") || fieldPath === "authBoundary") return STR;
  }

  // Flow
  if (kind === "flow") {
    if (startsWith(fieldPath, "steps") || startsWith(fieldPath, "failurePaths")) return STR;
  }

  // Component
  if (kind === "component") {
    if (startsWith(fieldPath, "copy")) return COS;
    if (startsWith(fieldPath, "props") || startsWith(fieldPath, "state")) return STR;
    if (fieldPath === "className" || startsWith(fieldPath, "classNames")) return COS;
  }

  // ClientState
  if (kind === "clientstate") {
    if (startsWith(fieldPath, "transitions") || fieldPath === "persistence") return STR;
  }

  // DesignToken — value/color/spacing/font are cosmetic
  if (kind === "designtoken") {
    return COS;
  }

  // Dependency — version bumps are structural by default
  if (kind === "dependency") {
    return STR;
  }

  return STR;
}
