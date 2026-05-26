import { describe, it, expect, vi } from "vitest";
import { Conductor } from "../src/conductor.js";
import type { Role, RoleRubric, RoleOutput } from "../src/role.js";
import { RoleEvalEscalation } from "../src/errors.js";
import { InMemoryVerdictSink } from "@atlas/eval-runtime";
import type { DispatchContext } from "../src/dispatch-context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CTX: DispatchContext = {
  ritualId: "r-eval-test" as never,
  graphVersion: 0,
  userTurn: "build a thing",
  projectId: "11111111-1111-4111-8111-111111111111"
};

const GOOD_OUTPUT: RoleOutput = { events: [], diff: { kind: "none" } };

function makeRubric(opts: {
  structuralPass: boolean[];
  judgePass: boolean[];
  fixableBy?: "retry" | "escalate";
}): RoleRubric {
  let si = 0;
  let ji = 0;
  return {
    roleId: "test",
    version: "test@1.0.0",
    structural(_output: unknown, _inv: unknown): any {
      const pass = opts.structuralPass[si++] ?? true;
      return pass
        ? { passed: true }
        : { passed: false, failures: [{ check: "x", reason: "y" }] };
    },
    async judge(_output: unknown, _inv: unknown, _llm: unknown): Promise<any> {
      const pass = opts.judgePass[ji++] ?? true;
      return {
        passed: pass,
        score: pass ? 9 : 4,
        dimensions: [{ name: "quality", score: pass ? 9 : 3, rationale: "test" }],
        fixableBy: opts.fixableBy ?? "retry",
        feedback: "test feedback"
      };
    }
  };
}

function makeConductor(role: Role, verdictSink: InMemoryVerdictSink): Conductor {
  const stubLlm = {}; // judge is mocked via rubric; llm not actually called
  return new Conductor({
    classifier: {
      classify: vi.fn().mockResolvedValue({ roleId: role.id, confidence: 1 })
    },
    roles: new Map([[role.id, role]]),
    checkpointSink: { emit: vi.fn().mockResolvedValue(undefined) },
    sliceBuilder: () => ({ bytes: "{}", hash: "sha256:zero" }),
    sleep: () => Promise.resolve(), // no delay in tests
    verdictSink,
    llm: stubLlm
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Conductor eval gate", () => {
  it("structural pass + judge pass → returns output without retry, 2 verdicts written", async () => {
    const sink = new InMemoryVerdictSink();
    const runFn = vi.fn<[], Promise<RoleOutput>>().mockResolvedValue(GOOD_OUTPUT);
    const role: Role = {
      id: "test",
      run: runFn,
      rubric: makeRubric({ structuralPass: [true], judgePass: [true] })
    };
    const conductor = makeConductor(role, sink);

    const result = await conductor.dispatch(TEST_CTX, { forceRoleId: "test" });

    expect(result.roleId).toBe("test");
    expect(runFn).toHaveBeenCalledTimes(1);
    // 1 structural verdict + 1 judge verdict
    expect(sink.verdicts).toHaveLength(2);
    expect(sink.verdicts.filter((v) => v.layer === "structural")).toHaveLength(1);
    expect(sink.verdicts.filter((v) => v.layer === "judge")).toHaveLength(1);
    expect(sink.verdicts.every((v) => v.passed)).toBe(true);
  });

  it("structural fail attempt 1, pass attempt 2 → retried with evalFeedback from structural", async () => {
    const sink = new InMemoryVerdictSink();
    const runFn = vi.fn<[], Promise<RoleOutput>>().mockResolvedValue(GOOD_OUTPUT);
    const role: Role = {
      id: "test",
      run: runFn,
      rubric: makeRubric({ structuralPass: [false, true], judgePass: [true] })
    };
    const conductor = makeConductor(role, sink);

    await conductor.dispatch(TEST_CTX, { forceRoleId: "test" });

    // Two quality attempts → two role.run calls
    expect(runFn).toHaveBeenCalledTimes(2);
    // Second call should have evalFeedback embedded
    const secondCallInv = runFn.mock.calls[1]![0] as any;
    expect(secondCallInv.evalFeedback?.source).toBe("structural");
    expect(secondCallInv.evalFeedback?.promptFragment).toMatch(/structural checks/);
    // 3 verdicts: structural(fail) + structural(pass) + judge(pass)
    expect(sink.verdicts).toHaveLength(3);
    expect(sink.verdicts[0]!.passed).toBe(false);
    expect(sink.verdicts[0]!.layer).toBe("structural");
  });

  it("judge fail with fixableBy=escalate → no retry, throws RoleEvalEscalation immediately", async () => {
    const sink = new InMemoryVerdictSink();
    const runFn = vi.fn<[], Promise<RoleOutput>>().mockResolvedValue(GOOD_OUTPUT);
    const role: Role = {
      id: "test",
      run: runFn,
      rubric: makeRubric({ structuralPass: [true], judgePass: [false], fixableBy: "escalate" })
    };
    const conductor = makeConductor(role, sink);

    await expect(conductor.dispatch(TEST_CTX, { forceRoleId: "test" })).rejects.toBeInstanceOf(RoleEvalEscalation);
    // fixableBy=escalate → no retry, only 1 call
    expect(runFn).toHaveBeenCalledTimes(1);
    // Verdicts: 1 structural(pass) + 1 judge(fail)
    expect(sink.verdicts).toHaveLength(2);
    expect(sink.verdicts[1]!.layer).toBe("judge");
    expect(sink.verdicts[1]!.passed).toBe(false);
  });

  it("judge fail with fixableBy=retry + second fail → 2 calls, throws RoleEvalEscalation", async () => {
    const sink = new InMemoryVerdictSink();
    const runFn = vi.fn<[], Promise<RoleOutput>>().mockResolvedValue(GOOD_OUTPUT);
    const role: Role = {
      id: "test",
      run: runFn,
      rubric: makeRubric({ structuralPass: [true, true], judgePass: [false, false], fixableBy: "retry" })
    };
    const conductor = makeConductor(role, sink);

    const err = await conductor.dispatch(TEST_CTX, { forceRoleId: "test" }).catch((e) => e);
    expect(err).toBeInstanceOf(RoleEvalEscalation);
    expect(runFn).toHaveBeenCalledTimes(2);
    // Second attempt should have judge feedback
    const secondCallInv = runFn.mock.calls[1]![0] as any;
    expect(secondCallInv.evalFeedback?.source).toBe("judge");
  });

  it("no rubric on role → back-compat: run once, no verdicts written", async () => {
    const sink = new InMemoryVerdictSink();
    const runFn = vi.fn<[], Promise<RoleOutput>>().mockResolvedValue(GOOD_OUTPUT);
    const role: Role = {
      id: "test",
      run: runFn
      // no rubric
    };
    const conductor = makeConductor(role, sink);

    const result = await conductor.dispatch(TEST_CTX, { forceRoleId: "test" });

    expect(result.roleId).toBe("test");
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(sink.verdicts).toHaveLength(0);
  });
});
