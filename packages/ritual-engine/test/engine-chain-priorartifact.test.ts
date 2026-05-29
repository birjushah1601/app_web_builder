import { describe, it, expect, vi } from "vitest";
import { RitualEngine } from "../src/index.js";
import type { SandboxApplier } from "../src/engine.js";

interface DispatchOpts {
  forceRoleId?: string;
  priorArtifact?: unknown;
}

const ARCHITECT_ARTIFACT_EVENT = {
  eventType: "architect.pass2.completed",
  payload: { artifact: { kind: "plan" } }
};

const VALID_DIFF =
  "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+hello\n";

/**
 * Plan D follow-up fix #1 — verify that post-developer chain roles receive
 * sandbox-context (sandboxId + previewUrl) on their priorArtifact in addition
 * to developerOutput. Without this, BackendArtifactRole always short-circuits
 * to backend-artifact.failed in production because the engine was only passing
 * `{ diff, summary }` to the chain.
 */
describe("RitualEngine.postDeveloperChain — priorArtifact threading", () => {
  it("passes sandbox metadata (sandboxId + previewUrl) into the chain's priorArtifact when a SandboxApplier supplies them", async () => {
    const chainPriorArtifacts: Array<Record<string, unknown> | undefined> = [];

    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      // architect path: no forceRoleId
      if (!opts?.forceRoleId) {
        return {
          roleId: "architect",
          output: {
            events: [ARCHITECT_ARTIFACT_EVENT],
            diff: { kind: "none" }
          }
        };
      }
      // developer path
      if (opts.forceRoleId === "developer") {
        return {
          roleId: "developer",
          output: {
            events: [{ eventType: "developer.completed", payload: { diff: VALID_DIFF, summary: "x" } }],
            diff: { kind: "patch", body: VALID_DIFF }
          }
        };
      }
      // chain role (e.g. backend-artifact): record what priorArtifact we got
      chainPriorArtifacts.push(opts.priorArtifact as Record<string, unknown> | undefined);
      return {
        roleId: opts.forceRoleId,
        output: {
          events: [{
            eventType: `${opts.forceRoleId}.completed`,
            payload: { passed: true, report: { passed: true } }
          }],
          diff: { kind: "none" }
        }
      };
    });

    // Applier that returns sandboxId + previewUrl alongside the apply outcome.
    const applier: SandboxApplier = {
      apply: vi.fn(async () => ({
        ok: true,
        parsed: 1,
        written: 1,
        failed: 0,
        skipped: 0,
        files: [{ path: "x", status: "written" as const, bytesWritten: 5 }],
        sandboxId: "sb-test-1",
        previewUrl: "https://sb-test-1.preview"
      }))
    };

    const engine = new RitualEngine({
      conductor: { dispatch } as never,
      eventSink: { emit: vi.fn() } as never,
      personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never,
      postDeveloperChain: ["backend-artifact"],
      sandboxApplier: applier
    });

    await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });

    expect(chainPriorArtifacts).toHaveLength(1);
    const prior = chainPriorArtifacts[0]!;
    // developerOutput fields still present
    expect(prior.diff).toBe(VALID_DIFF);
    expect(prior.summary).toBe("x");
    // sandbox metadata threaded through
    expect(prior.sandboxId).toBe("sb-test-1");
    expect(prior.previewUrl).toBe("https://sb-test-1.preview");
  });

  it("falls back to just developerOutput when no SandboxApplier is configured (back-compat)", async () => {
    const chainPriorArtifacts: Array<Record<string, unknown> | undefined> = [];

    const dispatch = vi.fn(async (_req: unknown, opts?: DispatchOpts) => {
      if (!opts?.forceRoleId) {
        return { roleId: "architect", output: { events: [ARCHITECT_ARTIFACT_EVENT], diff: { kind: "none" } } };
      }
      if (opts.forceRoleId === "developer") {
        return {
          roleId: "developer",
          output: {
            events: [{ eventType: "developer.completed", payload: { diff: VALID_DIFF, summary: "x" } }],
            diff: { kind: "patch", body: VALID_DIFF }
          }
        };
      }
      chainPriorArtifacts.push(opts.priorArtifact as Record<string, unknown> | undefined);
      return {
        roleId: opts.forceRoleId,
        output: {
          events: [{ eventType: `${opts.forceRoleId}.completed`, payload: { passed: true, report: { passed: true } } }],
          diff: { kind: "none" }
        }
      };
    });

    const engine = new RitualEngine({
      conductor: { dispatch } as never,
      eventSink: { emit: vi.fn() } as never,
      personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never,
      postDeveloperChain: ["security"]
    });

    await engine.start({ projectId: "p", userId: "u", userTurn: "x", editClass: "structural" });

    expect(chainPriorArtifacts).toHaveLength(1);
    const prior = chainPriorArtifacts[0]!;
    expect(prior.diff).toBe(VALID_DIFF);
    expect(prior.summary).toBe("x");
    // No applier wired → no sandbox fields exist on the chain priorArtifact.
    expect(prior.sandboxId).toBeUndefined();
    expect(prior.previewUrl).toBeUndefined();
  });
});
