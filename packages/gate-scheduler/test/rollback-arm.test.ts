import { describe, it, expect, vi } from "vitest";
import { RollbackArm, executeRollback } from "../src/rollback-arm.js";

describe("RollbackArm + executeRollback", () => {
  it("RollbackArm captures the commit + reason", () => {
    const arm = new RollbackArm("abc123", "L4 CVE-rated dependency");
    expect(arm.commitSha).toBe("abc123");
    expect(arm.reason).toContain("CVE");
    expect(arm.executed).toBe(false);
  });

  it("executeRollback runs git revert via injected runner + marks executed", async () => {
    const gitRevert = vi.fn(async () => "reverted abc123");
    const arm = new RollbackArm("abc123", "test");
    const result = await executeRollback(arm, gitRevert);
    expect(gitRevert).toHaveBeenCalledWith("abc123");
    expect(result.success).toBe(true);
    expect(arm.executed).toBe(true);
  });

  it("executeRollback failure surfaces error + arm stays unexecuted", async () => {
    const gitRevert = vi.fn(async () => { throw new Error("conflict"); });
    const arm = new RollbackArm("abc123", "test");
    const result = await executeRollback(arm, gitRevert);
    expect(result.success).toBe(false);
    expect(result.error).toContain("conflict");
    expect(arm.executed).toBe(false);
  });
});
