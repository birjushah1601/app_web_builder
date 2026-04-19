import { describe, expect, it } from "vitest";
import { ComplianceClassSchema } from "../../src/nodes/compliance-class.js";

const valid = {
  kind: "compliance" as const,
  id: "compliance:baseline",
  name: "baseline",
  scope: "global",
  attestation: "self-attested",
  effectiveDate: "2026-04-18"
};

describe("ComplianceClassSchema", () => {
  it("accepts the four v1 names", () => {
    for (const name of ["baseline", "GDPR", "HIPAA", "SOC2-lite"]) {
      expect(() => ComplianceClassSchema.parse({ ...valid, id: `compliance:${name.toLowerCase()}`, name })).not.toThrow();
    }
  });
  it("rejects out-of-scope class names (Phase B classes are validation errors in v1)", () => {
    for (const name of ["PCI-DSS", "DPDP-India", "LGPD", "POPIA", "COPPA", "FERPA", "ITAR", "ISO27001"]) {
      expect(() => ComplianceClassSchema.parse({ ...valid, name })).toThrow();
    }
  });
  it("requires effectiveDate (ISO date)", () => {
    expect(() => ComplianceClassSchema.parse({ ...valid, effectiveDate: "yesterday" })).toThrow();
  });
});
