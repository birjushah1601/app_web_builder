import { describe, it, expect } from "vitest";
import { branchSchemaName, BranchNameError } from "../src/naming.js";

describe("branchSchemaName", () => {
  it("returns deterministic name for a (projectId, branchId)", () => {
    const a = branchSchemaName("11111111-1111-4111-8111-111111111111", "main");
    const b = branchSchemaName("11111111-1111-4111-8111-111111111111", "main");
    expect(a).toBe(b);
  });

  it("includes a stable prefix and a hashed suffix", () => {
    const name = branchSchemaName("11111111-1111-4111-8111-111111111111", "preview-42");
    expect(name).toMatch(/^br_[0-9a-f]{16}$/);
  });

  it("differs across branches in the same project", () => {
    const a = branchSchemaName("11111111-1111-4111-8111-111111111111", "main");
    const b = branchSchemaName("11111111-1111-4111-8111-111111111111", "preview-42");
    expect(a).not.toBe(b);
  });

  it("rejects branchId with characters that could escape SQL identifier rules", () => {
    expect(() =>
      branchSchemaName("11111111-1111-4111-8111-111111111111", 'main"; DROP SCHEMA public; --')
    ).toThrow(BranchNameError);
  });

  it("rejects empty branchId", () => {
    expect(() => branchSchemaName("11111111-1111-4111-8111-111111111111", "")).toThrow(BranchNameError);
  });
});
