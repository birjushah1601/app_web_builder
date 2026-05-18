import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";
import { TemplateIdSchema, KNOWN_ATLAS_TEMPLATES, SandboxRecordSchema } from "../src/index.js";

describe("public API surface", () => {
  it("exports all canonical names", () => {
    const expected = [
      // types
      "SandboxIdSchema",
      "TemplateIdSchema",
      "KNOWN_ATLAS_TEMPLATES",
      "SandboxStatusSchema",
      "SandboxRecordSchema",
      "TemplateDigestSchema",
      // lifecycle
      "E2BLifecycle",
      // filesystem
      "E2BFileSystem",
      // exec
      "E2BExec",
      // preview
      "E2BPreview",
      // cost-cap
      "checkSpendCap",
      "SpendCapConfigSchema",
      // errors
      "SandboxNotFoundError",
      "SandboxProvisionError",
      "SpendCapExceededError",
    ];
    for (const name of expected) {
      expect((api as Record<string, unknown>)[name], `missing export: ${name}`).toBeDefined();
    }
  });
});

describe("TemplateIdSchema permissiveness", () => {
  it("accepts the known atlas-* template names", () => {
    for (const name of KNOWN_ATLAS_TEMPLATES) {
      expect(TemplateIdSchema.parse(name)).toBe(name);
    }
  });

  it("accepts arbitrary E2B template IDs (alphanumeric, e.g. user-built templates)", () => {
    // This is the regression for the user-reported bug: passing a real E2B
    // template ID like "6f5mwsacoiiqt0qj1bgx" used to fail with
    // ZodError(invalid_enum_value) because TemplateIdSchema was a strict
    // enum of 6 names. E2B's SDK accepts either name or ID, so the schema
    // now mirrors that flexibility.
    expect(TemplateIdSchema.parse("6f5mwsacoiiqt0qj1bgx")).toBe("6f5mwsacoiiqt0qj1bgx");
    expect(TemplateIdSchema.parse("my-custom-template")).toBe("my-custom-template");
  });

  it("rejects empty strings (must be at least 1 char)", () => {
    expect(() => TemplateIdSchema.parse("")).toThrow();
  });

  it("SandboxRecordSchema accepts records carrying arbitrary template IDs", () => {
    // The regression bit downstream — SandboxRecordSchema embeds TemplateIdSchema,
    // so loosening one without the other would still throw inside provision().
    const record = SandboxRecordSchema.parse({
      sandboxId: "sb_test_123",
      templateId: "6f5mwsacoiiqt0qj1bgx",
      projectId: "11111111-1111-4111-8111-111111111111",
      provisionedAt: "2026-04-26T00:00:00.000Z",
      status: "running"
    });
    expect(record.templateId).toBe("6f5mwsacoiiqt0qj1bgx");
  });
});
