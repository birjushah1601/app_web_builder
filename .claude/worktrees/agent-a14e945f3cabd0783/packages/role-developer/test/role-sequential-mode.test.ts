import { describe, it, expect, vi } from "vitest";
import { DeveloperRole } from "../src/role.js";
import type { LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";

/** Minimal mock provider: completeWithToolUse returns whatever the test stubs. */
function mockProvider(impl: (tool: string) => Promise<{ toolName: string; input: unknown }>): LLMProvider {
  return {
    name: "mock",
    complete: vi.fn(),
    stream: vi.fn() as never,
    completeWithToolUse: vi.fn(async (_messages, options) => {
      const toolName = (options as { toolChoice?: { name?: string } }).toolChoice?.name ?? "unknown";
      return impl(toolName);
    })
  } as unknown as LLMProvider;
}

/** Minimal in-memory SkillRegistry stub satisfying assembleDeveloperPrompt's
 *  .get(name) lookup for the three skills it needs. */
function fakeSkillRegistry(): SkillRegistry {
  const skill = (name: string) => ({
    name,
    description: `mock ${name}`,
    body: `# ${name}\n\nMock content.`,
    triggers: [] as string[],
    inputSchema: undefined,
    deps: [] as string[]
  });
  const map = new Map<string, ReturnType<typeof skill>>([
    ["tdd-feature", skill("tdd-feature")],
    ["edit-only-what-changed", skill("edit-only-what-changed")],
    ["runnable-plan", skill("runnable-plan")]
  ]);
  return {
    get: (name: string) => map.get(name),
    list: () => Array.from(map.values()),
    activate: () => null,
    isOverridden: () => false
  } as unknown as SkillRegistry;
}

const VALID_DEVELOPER_OUTPUT = {
  diff: "diff --git a/x b/x",
  summary: "x",
  testsAdded: ["t.ts"],
  filesModified: ["x.ts"]
};

const VALID_REVIEWER_VOTE = { winner: "anthropic", reasoning: "tighter" };

describe("DeveloperRole — parallelMode option (F1 fix)", () => {
  it("default ('parallel') fires both passes concurrently — google starts before anthropic resolves", async () => {
    const callOrder: Array<{ tool: string; phase: "start" | "end" }> = [];

    const anthropic = mockProvider(async (tool) => {
      callOrder.push({ tool, phase: "start" });
      await new Promise((r) => setTimeout(r, 50));
      callOrder.push({ tool, phase: "end" });
      return { toolName: tool, input: VALID_DEVELOPER_OUTPUT };
    });
    const google = mockProvider(async (tool) => {
      callOrder.push({ tool: `google-${tool}`, phase: "start" });
      await new Promise((r) => setTimeout(r, 50));
      callOrder.push({ tool: `google-${tool}`, phase: "end" });
      return { toolName: tool, input: VALID_DEVELOPER_OUTPUT };
    });
    const reviewer = mockProvider(async (tool) => ({ toolName: tool, input: VALID_REVIEWER_VOTE }));

    const role = new DeveloperRole({
      anthropic, google, reviewer, skills: fakeSkillRegistry()
      // parallelMode unset → defaults to "parallel"
    });
    await role.run({
      ritualId: "r-1",
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "x"
    });

    // Both starts MUST appear before either end (proves concurrency).
    const firstEnd = callOrder.findIndex((c) => c.phase === "end");
    const startsBeforeFirstEnd = callOrder.slice(0, firstEnd).filter((c) => c.phase === "start");
    expect(startsBeforeFirstEnd.length).toBe(2);
  });

  it("'sequential' runs anthropic to completion BEFORE google starts (one-at-a-time on the proxy)", async () => {
    const callOrder: Array<{ tool: string; phase: "start" | "end" }> = [];

    const anthropic = mockProvider(async (tool) => {
      callOrder.push({ tool: `anth-${tool}`, phase: "start" });
      await new Promise((r) => setTimeout(r, 50));
      callOrder.push({ tool: `anth-${tool}`, phase: "end" });
      return { toolName: tool, input: VALID_DEVELOPER_OUTPUT };
    });
    const google = mockProvider(async (tool) => {
      callOrder.push({ tool: `google-${tool}`, phase: "start" });
      await new Promise((r) => setTimeout(r, 50));
      callOrder.push({ tool: `google-${tool}`, phase: "end" });
      return { toolName: tool, input: VALID_DEVELOPER_OUTPUT };
    });
    const reviewer = mockProvider(async (tool) => ({ toolName: tool, input: VALID_REVIEWER_VOTE }));

    const role = new DeveloperRole({
      anthropic, google, reviewer, skills: fakeSkillRegistry(),
      parallelMode: "sequential"
    });
    await role.run({
      ritualId: "r-1",
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "x"
    });

    // Strict order: anth-start, anth-end, google-start, google-end, ...
    const labels = callOrder.map((c) => `${c.tool}:${c.phase}`);
    const anthStart = labels.indexOf(labels.find((l) => l.startsWith("anth-") && l.endsWith(":start"))!);
    const anthEnd = labels.indexOf(labels.find((l) => l.startsWith("anth-") && l.endsWith(":end"))!);
    const googStart = labels.indexOf(labels.find((l) => l.startsWith("google-") && l.endsWith(":start"))!);
    expect(anthStart).toBeLessThan(anthEnd);
    expect(anthEnd).toBeLessThan(googStart); // google didn't start until anthropic finished
  });

  it("sequential mode still produces the same final result as parallel (functional equivalence)", async () => {
    const anthropic = mockProvider(async (tool) => ({ toolName: tool, input: VALID_DEVELOPER_OUTPUT }));
    const google = mockProvider(async (tool) => ({ toolName: tool, input: VALID_DEVELOPER_OUTPUT }));
    const reviewer = mockProvider(async (tool) => ({ toolName: tool, input: VALID_REVIEWER_VOTE }));

    const sequential = new DeveloperRole({
      anthropic, google, reviewer, skills: fakeSkillRegistry(),
      parallelMode: "sequential"
    });
    const out = await sequential.run({
      ritualId: "r-1",
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "x"
    });

    expect(out.diff).toEqual({ kind: "patch", body: "diff --git a/x b/x" });
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("developer.anthropic.completed");
    expect(types).toContain("developer.google.completed");
    expect(types).toContain("developer.reviewer.voted");
    expect(types).toContain("developer.completed");
  });
});
