import { describe, it, expect } from "vitest";
import { rateField, type EditClass } from "../src/rules.js";

describe("rules.rateField", () => {
  const cases: Array<[string, string, string, EditClass]> = [
    ["page:home", "title", "page", "cosmetic"],
    ["page:home", "path", "page", "structural"],
    ["page:home", "renderMode", "page", "structural"],
    ["page:home", "authRequired", "page", "structural"],
    ["model:user", "rlsPolicies.select", "model", "security-compliance-touching"],
    ["model:user", "piiFields", "model", "security-compliance-touching"],
    ["authboundary:user", "anything", "authboundary", "security-compliance-touching"],
    ["compliance:hipaa", "anything", "compliance", "security-compliance-touching"],
    ["$root", "complianceClasses", "$root", "security-compliance-touching"],
    ["$root", "databaseProvider", "$root", "structural"],
    ["$root", "databaseProvider.region", "$root", "structural"],
    ["component:button", "copy", "component", "cosmetic"],
    ["component:button", "props", "component", "structural"],
    ["designtoken:primary", "value", "designtoken", "cosmetic"],
    ["dependency:react", "version", "dependency", "structural"]
  ];

  for (const [nodeId, field, kind, expected] of cases) {
    it(`${nodeId}/${field} (${kind}) → ${expected}`, () => {
      expect(rateField(nodeId, field, kind)).toBe(expected);
    });
  }
});
