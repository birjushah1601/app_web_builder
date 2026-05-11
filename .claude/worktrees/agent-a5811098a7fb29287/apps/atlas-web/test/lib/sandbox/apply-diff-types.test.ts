import { describe, it, expectTypeOf } from "vitest";
import type {
  FileOp,
  FileApplyResult,
  ApplyDiffResult,
  SandboxFileSystemLike
} from "@/lib/sandbox/apply-diff-types";

describe("apply-diff types", () => {
  it("FileOp.kind is the strict 3-value union", () => {
    expectTypeOf<FileOp["kind"]>().toEqualTypeOf<"create" | "modify" | "delete">();
  });

  it("FileApplyResult.status is the strict 3-value union", () => {
    expectTypeOf<FileApplyResult["status"]>().toEqualTypeOf<"written" | "skipped" | "failed">();
  });

  it("ApplyDiffResult counts every parsed file in exactly one bucket", () => {
    // Compile-time assertion — written + skipped + failed should always
    // sum to parsed; this is enforced by callers, but the types let us
    // require all four counters at construction time.
    const r: ApplyDiffResult = {
      ok: true, parsed: 0, written: 0, failed: 0, skipped: 0, files: []
    };
    expectTypeOf(r).toMatchTypeOf<ApplyDiffResult>();
  });

  it("SandboxFileSystemLike has read/write/exists methods returning Promises", () => {
    expectTypeOf<SandboxFileSystemLike["read"]>().returns.toEqualTypeOf<Promise<string>>();
    expectTypeOf<SandboxFileSystemLike["write"]>().returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf<SandboxFileSystemLike["exists"]>().returns.toEqualTypeOf<Promise<boolean>>();
  });
});
