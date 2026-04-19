import { SpecGraphSchema, type SpecGraph } from "./graph.js";
import { runInvariants, type ValidationResult, type ValidationIssue, type Invariant } from "./invariants/runner.js";

import { i01PageRouteRef } from "./invariants/i01-page-routeref.js";
import { i02EndpointRouteRef } from "./invariants/i02-endpoint-routeref.js";
import { i03PageAuthRequiredNeedsBoundary } from "./invariants/i03-page-auth-required-needs-boundary.js";
import { i04PiiMutatingEndpointNeedsAuthAndCompliance } from "./invariants/i04-pii-mutating-endpoint-needs-auth-and-compliance.js";
import { i05PiiModelNeedsRls } from "./invariants/i05-pii-model-needs-rls.js";
import { i06NoCriticalCves } from "./invariants/i06-no-critical-cves.js";
import { i07RendersTargetExists } from "./invariants/i07-renders-target-exists.js";
import { i08BaselineCompliancePresent } from "./invariants/i08-baseline-compliance-present.js";
import { i09TestCoverageRequiredTargets } from "./invariants/i09-test-coverage-required-targets.js";
import { i10AiFeaturePersonalizedNeedsCompliance } from "./invariants/i10-aifeature-personalized-needs-compliance.js";
import { i11MediaAssetGeneratedNeedsProvider } from "./invariants/i11-mediaasset-generated-needs-provider.js";
import { i12PiiClientStateNeedsCompliance } from "./invariants/i12-pii-clientstate-needs-compliance.js";
import { i13BaselineTestsForProtectedTargets } from "./invariants/i13-baseline-tests-for-protected-targets.js";
import { i14MediaAssetKindAllowlistV1 } from "./invariants/i14-mediaasset-kind-allowlist-v1.js";

export const ALL_INVARIANTS: Invariant[] = [
  i01PageRouteRef,
  i02EndpointRouteRef,
  i03PageAuthRequiredNeedsBoundary,
  i04PiiMutatingEndpointNeedsAuthAndCompliance,
  i05PiiModelNeedsRls,
  i06NoCriticalCves,
  i07RendersTargetExists,
  i08BaselineCompliancePresent,
  i09TestCoverageRequiredTargets,
  i10AiFeaturePersonalizedNeedsCompliance,
  i11MediaAssetGeneratedNeedsProvider,
  i12PiiClientStateNeedsCompliance,
  i13BaselineTestsForProtectedTargets,
  i14MediaAssetKindAllowlistV1
];

/**
 * Validate a graph: structural (Zod) parse first, then run all 14 invariants.
 * If structural parse fails, no invariants run — returns issues from Zod only.
 */
export function validate(input: unknown): ValidationResult {
  const parse = SpecGraphSchema.safeParse(input);
  if (!parse.success) {
    const issues: ValidationIssue[] = parse.error.issues.map((iss) => ({
      code: `STRUCTURAL_${iss.code.toUpperCase()}`,
      message: iss.message,
      path: iss.path
    }));
    return { ok: false, issues };
  }
  return runInvariants(parse.data, ALL_INVARIANTS);
}

export type GraphValidator = (input: unknown) => ValidationResult;
export type { ValidationResult, ValidationIssue, Invariant, SpecGraph };
