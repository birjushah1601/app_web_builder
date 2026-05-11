import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { deepPlan } from "../src/deep-plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

function providerReturning(toolInput: unknown) {
  const sdkCreate = vi.fn(async () => ({
    content: [{ type: "tool_use", id: "tu", name: "emit_architect_output", input: toolInput }],
    model: "claude-opus-4-7",
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 }
  }));
  return new AnthropicProvider({
    sdk: { messages: { create: sdkCreate, stream: vi.fn() } } as never,
    metrics: createProviderMetrics(new Registry())
  });
}

const slice = { bytes: "{}", hash: "sha256:" + "0".repeat(64) };
const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

describe("deepPlan scope variants", () => {
  it("parses new-app scope", async () => {
    const out = await deepPlan({
      userTurn: "create",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "new-app", questions: [] },
      skills,
      llm: providerReturning({
        scope: "new-app",
        specGraph: { nodes: {}, edges: [] },
        runnablePlan: { tasks: [] },
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("new-app");
  });

  it("parses bug-fix scope", async () => {
    const out = await deepPlan({
      userTurn: "debug",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "bug-fix", questions: [] },
      skills,
      llm: providerReturning({
        scope: "bug-fix",
        bugReport: {
          phase1_reproduce: "steps",
          phase2_isolate: "minimal case",
          phase3_hypothesize: "h1",
          phase4_verify: "test",
          rootCause: "race"
        },
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("bug-fix");
    if (out.scope === "bug-fix") {
      expect(out.bugReport.rootCause).toBe("race");
    }
  });

  it("parses dep-upgrade scope", async () => {
    const out = await deepPlan({
      userTurn: "upgrade",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "dep-upgrade", questions: [] },
      skills,
      llm: providerReturning({
        scope: "dep-upgrade",
        breakingChangeMatrix: [{ change: "x", affectedCallsites: ["a.ts"], migration: "rename" }],
        rollbackPlan: "git revert",
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("dep-upgrade");
  });

  it("parses refactor scope", async () => {
    const out = await deepPlan({
      userTurn: "refactor",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "refactor", questions: [] },
      skills,
      llm: providerReturning({
        scope: "refactor",
        beforeAfterGraph: { before: {}, after: {} },
        behaviorPreservationContract: ["public API unchanged"],
        regressionTests: ["test1"],
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("refactor");
  });

  it("parses ship scope", async () => {
    const out = await deepPlan({
      userTurn: "ship",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "ship", questions: [] },
      skills,
      llm: providerReturning({
        scope: "ship",
        rerunnableSteps: [{ name: "deploy", command: "pnpm run deploy", idempotent: true }],
        rollbackTrigger: "one-click",
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("ship");
  });

  it("parses migrate scope", async () => {
    const out = await deepPlan({
      userTurn: "migrate",
      graphSlice: slice,
      ambiguity: { passed: true, scope: "migrate", questions: [] },
      skills,
      llm: providerReturning({
        scope: "migrate",
        stagedPlan: [{ stage: "dual-run", cutoverWindow: "2h", rollback: "revert DNS" }],
        complianceEvidence: ["hipaa-log"],
        graphSlice: slice
      })
    });
    expect(out.scope).toBe("migrate");
  });
});
