import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "../../../tools/test-gen-cli.mjs");
const REPO_ROOT = resolve(__dirname, "../../..");

describe("test-gen-cli smoke", () => {
  it("baseline list prints kind lines", () => {
    const out = execFileSync("node", [CLI, "baseline", "list"], {
      encoding: "utf8",
      cwd: REPO_ROOT
    });
    expect(out).toMatch(/authboundary:/);
    expect(out).toMatch(/pii-model:/);
    expect(out).toMatch(/compliance:/);
  });

  it("baseline show authboundary prints first assertion", () => {
    const out = execFileSync("node", [CLI, "baseline", "show", "authboundary"], {
      encoding: "utf8",
      cwd: REPO_ROOT
    });
    expect(out).toMatch(/unauthed-returns-401/);
  });
});
