import { describe, it, expect } from "vitest";
import { ApprovalDecisionSchema, applyApproval, type ApprovalDecision } from "../src/approval.js";

describe("ApprovalDecision", () => {
  it("parses an approved decision", () => {
    const d: ApprovalDecision = {
      kind: "approved",
      approvedBy: "u-1",
      persona: "diego"
    };
    expect(ApprovalDecisionSchema.parse(d)).toEqual(d);
  });

  it("parses a changes_requested decision with notes", () => {
    const d: ApprovalDecision = {
      kind: "changes_requested",
      requestedBy: "u-1",
      notes: "Needs RTL handling"
    };
    expect(ApprovalDecisionSchema.parse(d)).toEqual(d);
  });

  it("rejects approval with empty notes for changes_requested", () => {
    expect(() => ApprovalDecisionSchema.parse({
      kind: "changes_requested",
      requestedBy: "u-1",
      notes: ""
    })).toThrow();
  });

  it("applyApproval(approved) → state transition object", () => {
    const tx = applyApproval({ kind: "approved", approvedBy: "u-1", persona: "diego" });
    expect(tx).toEqual({ kind: "approved" });
  });

  it("applyApproval(changes_requested) → state transition object", () => {
    const tx = applyApproval({ kind: "changes_requested", requestedBy: "u-1", notes: "x" });
    expect(tx).toEqual({ kind: "changes_requested" });
  });
});
