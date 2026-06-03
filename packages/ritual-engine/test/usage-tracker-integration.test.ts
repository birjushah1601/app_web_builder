// Real-RitualEngine + real-Conductor + real-roles end-to-end usage-tracker
// integration. Closes the verification gap left by Plan G.4 Tasks 1-4:
// every prior test stubbed at least one boundary (Conductor in Task 2,
// IRitualEngine in Task 4). This one wires them all together against the
// real InMemoryUsageTracker and verifies the breakdown actually splits
// per-role from inside the conductor's RoleInvocation pipeline.
//
// Uses roleChain=[...] to bypass the default architect→developer→canvas-pause
// →build-gate state machine (whose convergence is tested separately and not
// the subject of this test). The roleChain branch in RitualEngine.start is
// exactly what the workflow-engine uses for tests/iac/deploy nodes in
// production, so it's a production-shape path.

import { describe, it, expect, vi } from "vitest";
import { Conductor, TestRole, type Role, type RoleInvocation, type RoleOutput } from "@atlas/conductor";
import { InMemoryUsageTracker } from "@atlas/llm-provider";
import { RitualEngine } from "../src/index.js";

describe("RitualEngine end-to-end — usageTracker reaches roles via real Conductor", () => {
  it("real RitualEngine + real Conductor + InMemoryUsageTracker → per-role breakdown reflects every role in the chain", async () => {
    const tracker = new InMemoryUsageTracker();

    // Two stub roles that BOTH call inv.usageTracker.record(...) — exactly the
    // contract Plan G.4 Task 3 introduced for real roles. The roles are
    // structurally identical to production roles (architect, tester, etc.)
    // in this respect; the only thing the stub avoids is real LLM IO.
    const plannerRole = new TestRole({
      roleId: "workflow-planner",
      onRun: async (inv: RoleInvocation): Promise<RoleOutput> => {
        inv.usageTracker?.record(
          "anthropic",
          "claude-haiku-4-5",
          { inputTokens: 200, outputTokens: 50 },
          { roleId: "workflow-planner" }
        );
        return {
          events: [{
            eventType: "workflow_planner.dag.emitted",
            payload: {
              nodes: [{ id: "tests-1", artifactKind: "tests", summary: "smoke tests" }],
              dependencyProfile: { schemaVersion: "1" }
            }
          }],
          diff: { kind: "none" as const }
        };
      }
    });

    const testerRole = new TestRole({
      roleId: "tester",
      onRun: async (inv: RoleInvocation): Promise<RoleOutput> => {
        inv.usageTracker?.record(
          "anthropic",
          "claude-sonnet-4-6",
          // 100k input sonnet ≈ $0.30; 50k output ≈ $0.75 → ~$1.05
          { inputTokens: 100_000, outputTokens: 50_000 },
          { roleId: "tester" }
        );
        return {
          events: [{
            eventType: "ritual.artifact_emitted",
            payload: {
              fromRole: "tester",
              artifact: { schemaVersion: "1", kind: "tests", framework: "vitest", specs: [] }
            }
          }],
          diff: { kind: "none" as const }
        };
      }
    });

    // Real Conductor — no stubs. Classifier isn't exercised because roleChain
    // bypasses it via forceRoleId, but we still need a classify() that returns
    // *something* schema-valid.
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "workflow-planner", confidence: 1 }) },
      roles: new Map<string, Role>([
        ["workflow-planner", plannerRole],
        ["tester", testerRole]
      ]),
      checkpointSink: { emit: async () => {} },
      sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
    });

    // Real RitualEngine wired to the real Conductor. eventSink + persona-
    // preferences are minimal real-shape stubs (they only need the contract
    // surface, no behaviour).
    const ritualEngine = new RitualEngine({
      conductor,
      eventSink: { emit: vi.fn() } as never,
      personaPreferences: { resolveFor: vi.fn(async () => ({ persona: "ama", source: "default" })) } as never
    });

    // Drive the ritual with roleChain so both roles run in sequence. This is
    // the same path the workflow-engine takes for tests/iac/deploy nodes.
    const ritualId = await ritualEngine.start({
      projectId: "00000000-0000-0000-0000-000000000001",
      userId: "user-int-test",
      userTurn: "smoke-test the tracker plumbing",
      editClass: "structural",
      roleChain: ["workflow-planner", "tester"],
      usageTracker: tracker
    });

    // Sanity: the ritual reached terminal state, the planner's DAG event +
    // tester's artifact event both made it into roleEvents.
    const snap = await ritualEngine.getRitual(ritualId);
    expect(snap).toBeDefined();
    const eventTypes = snap!.roleEvents.map((e) => e.eventType);
    expect(eventTypes).toContain("workflow_planner.dag.emitted");
    expect(eventTypes).toContain("ritual.artifact_emitted");
    expect(snap!.artifact).toMatchObject({ kind: "tests", framework: "vitest" });

    // The contract under test: the tracker that the workflow-engine would
    // hold has TWO buckets — workflow-planner + tester — populated from
    // inside the real Conductor.dispatch → RoleInvocation → role.run path.
    // If any hop on that path failed to forward the tracker, one or both
    // buckets would be missing (or both would collapse into __unassigned__).
    const breakdown = tracker.breakdown();
    const roleIds = breakdown.map((e) => e.roleId).sort();
    expect(roleIds).toEqual(["tester", "workflow-planner"]);
    expect(roleIds).not.toContain("__unassigned__");

    const planner = breakdown.find((e) => e.roleId === "workflow-planner");
    const tester = breakdown.find((e) => e.roleId === "tester");
    expect(planner?.callCount).toBe(1);
    expect(tester?.callCount).toBe(1);
    // Tester's spend should dominate (sonnet 100k+50k vs haiku 200+50)
    expect(tester!.totalUsd).toBeGreaterThan(planner!.totalUsd);
    // Total is the sum of per-role totals (sanity for the tracker math)
    expect(tracker.totalUsd()).toBeCloseTo(planner!.totalUsd + tester!.totalUsd, 8);
  });
});
