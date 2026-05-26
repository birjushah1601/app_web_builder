import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { plannerTriage, PLANNER_TRIAGE_MODEL } from "../src/triage.js";

function makeProvider(toolInput: unknown, toolName = "emit_planner_triage") {
  const sdkCreate = vi.fn(async () => ({
    content: [{ type: "tool_use", id: "tu_1", name: toolName, input: toolInput }],
    model: PLANNER_TRIAGE_MODEL,
    stop_reason: "tool_use",
    usage: { input_tokens: 20, output_tokens: 10 }
  }));
  const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
  return {
    provider: new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) }),
    sdkCreate
  };
}

describe("plannerTriage — Task 6", () => {
  it("returns passed=true when LLM emits 0 blocker questions", async () => {
    const { provider, sdkCreate } = makeProvider({ passed: true, questions: [] });

    const report = await plannerTriage({
      userTurn: "build a SaaS platform with login and billing",
      llm: provider
    });

    expect(report.passed).toBe(true);
    expect(report.questions).toHaveLength(0);

    const call = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.model).toBe(PLANNER_TRIAGE_MODEL);
    const tools = call.tools as Array<{ name: string; input_schema: Record<string, unknown> }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("emit_planner_triage");
    expect(tools[0].input_schema.type).toBe("object");
  });

  it("returns passed=false when LLM emits a yes-no blocker question", async () => {
    const { provider } = makeProvider({
      passed: false,
      questions: [
        {
          question: "Should the platform use Stripe or Lago for billing?",
          reason: "Prompt says billing but uses Stripe-specific terms — may conflict with OSS default",
          severity: "blocker",
          widgetKind: "single-select",
          options: ["Stripe", "Lago"]
        }
      ]
    });

    const report = await plannerTriage({
      userTurn: "build a SaaS with Stripe-powered billing",
      llm: provider
    });

    expect(report.passed).toBe(false);
    expect(report.questions).toHaveLength(1);
    const q = report.questions[0];
    expect(q.severity).toBe("blocker");
    expect(q.widgetKind).toBe("single-select");
    expect(q.options).toEqual(["Stripe", "Lago"]);
  });

  it("threads suggestedKinds into the user message", async () => {
    const { provider, sdkCreate } = makeProvider({ passed: true, questions: [] });

    await plannerTriage({
      userTurn: "build a platform",
      suggestedKinds: ["frontend-app", "backend-rest-api"],
      llm: provider
    });

    const call = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    const messages = call.messages as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === "user")!;
    expect(userMsg.content).toContain("frontend-app");
    expect(userMsg.content).toContain("backend-rest-api");
  });

  it("throws PlannerTriageFailedError when LLM returns inconsistent payload", async () => {
    // passed=true but has a blocker question — schema rejects this
    const { provider } = makeProvider({
      passed: true,
      questions: [{ question: "q", reason: "r", severity: "blocker" }]
    });

    await expect(
      plannerTriage({ userTurn: "build something", llm: provider })
    ).rejects.toThrow(/PlannerTriageReportSchema|passed cannot be true/i);
  });
});
