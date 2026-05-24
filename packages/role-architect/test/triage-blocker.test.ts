import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { triage } from "../src/triage.js";

describe("triage (Pass 1 blocker path)", () => {
  it("returns passed=false when the model emits a blocker question", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "emit_ambiguity_report",
          input: {
            passed: false,
            scope: "new-app",
            questions: [
              { question: "What compliance class applies?", reason: "PII storage mentioned", severity: "blocker" }
            ]
          }
        }
      ],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const report = await triage({
      userTurn: "build me an app that stores customer health data",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      llm: provider
    });

    expect(report.passed).toBe(false);
    expect(report.questions).toHaveLength(1);
    expect(report.questions[0].severity).toBe("blocker");
    expect(report.questions[0].question).toMatch(/compliance/i);
  });

  it("rejects invalid triage output — passed=true with a blocker question", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "emit_ambiguity_report",
          input: {
            passed: true, // inconsistent with the blocker question below
            scope: "new-feature",
            questions: [{ question: "q", reason: "r", severity: "blocker" }]
          }
        }
      ],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 3 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    await expect(triage({
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      llm: provider
    })).rejects.toThrow(/AmbiguityReportSchema|passed cannot be true/i);
  });

  it("accepts widgetKind + options when the model declares them (Plan U full)", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "emit_ambiguity_report",
          input: {
            passed: false,
            scope: "new-app",
            questions: [
              {
                question: "Which payment provider should we integrate?",
                reason: "user mentioned live payments",
                severity: "blocker",
                widgetKind: "single-select",
                options: ["Stripe", "Razorpay", "PayPal"]
              },
              {
                question: "Include guest checkout?",
                reason: "auth flow varies",
                severity: "blocker",
                widgetKind: "yes-no"
              }
            ]
          }
        }
      ],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "tool_use",
      usage: { input_tokens: 30, output_tokens: 15 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const report = await triage({
      userTurn: "build a checkout flow",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      llm: provider
    });

    expect(report.passed).toBe(false);
    expect(report.questions).toHaveLength(2);
    expect(report.questions[0].widgetKind).toBe("single-select");
    expect(report.questions[0].options).toEqual(["Stripe", "Razorpay", "PayPal"]);
    expect(report.questions[1].widgetKind).toBe("yes-no");
    expect(report.questions[1].options).toBeUndefined();
  });
});
