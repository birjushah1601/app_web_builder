import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("public API surface", () => {
  it("exports all canonical names", () => {
    const expected = [
      // types
      "SandboxIdSchema",
      "TemplateIdSchema",
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
