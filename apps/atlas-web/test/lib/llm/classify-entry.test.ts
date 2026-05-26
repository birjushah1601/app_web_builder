import { describe, it, expect } from "vitest";
import { classifyEntry } from "@/lib/llm/classify-entry";
import type { LLMProvider } from "@atlas/llm-provider";

function makeLlm(result: object): LLMProvider {
  return {
    completeWithToolUse: async () => ({ input: result })
  } as unknown as LLMProvider;
}

describe("classifyEntry", () => {
  it("returns single-ritual result from stub LLM", async () => {
    const stub = makeLlm({ mode: "single-ritual", reasoning: "landing page" });
    const result = await classifyEntry({ prompt: "Build a landing page" }, stub);
    expect(result.mode).toBe("single-ritual");
    expect(result.reasoning).toBe("landing page");
    expect(result.suggestedKinds).toBeUndefined();
  });

  it("returns workflow result with suggestedKinds from stub LLM", async () => {
    const stub = makeLlm({
      mode: "workflow",
      suggestedKinds: ["frontend-app", "backend-rest-api"],
      reasoning: "multi-tier SaaS with users and billing"
    });
    const result = await classifyEntry(
      { prompt: "Build a SaaS platform with login and billing" },
      stub
    );
    expect(result.mode).toBe("workflow");
    expect(result.suggestedKinds).toEqual(["frontend-app", "backend-rest-api"]);
    expect(result.reasoning).toBe("multi-tier SaaS with users and billing");
  });

  it("includes artifactKindHint in the user turn when provided", async () => {
    let capturedMessages: unknown[] = [];
    const stub = {
      completeWithToolUse: async (messages: unknown[]) => {
        capturedMessages = messages;
        return { input: { mode: "single-ritual", reasoning: "explicit hint" } };
      }
    } as unknown as LLMProvider;

    await classifyEntry(
      { prompt: "Build a dashboard", artifactKindHint: "frontend-app" },
      stub
    );

    const userMessage = capturedMessages.find(
      (m) => (m as { role: string }).role === "user"
    ) as { role: string; content: string } | undefined;
    expect(userMessage).toBeDefined();
    expect(userMessage!.content).toContain("artifactKind: frontend-app");
    expect(userMessage!.content).toContain("Build a dashboard");
  });

  it("omits artifactKindHint from user turn when not provided", async () => {
    let capturedMessages: unknown[] = [];
    const stub = {
      completeWithToolUse: async (messages: unknown[]) => {
        capturedMessages = messages;
        return { input: { mode: "single-ritual", reasoning: "no hint" } };
      }
    } as unknown as LLMProvider;

    await classifyEntry({ prompt: "Build a CLI tool" }, stub);

    const userMessage = capturedMessages.find(
      (m) => (m as { role: string }).role === "user"
    ) as { role: string; content: string } | undefined;
    expect(userMessage).toBeDefined();
    expect(userMessage!.content).not.toContain("artifactKind");
    expect(userMessage!.content).toContain("Build a CLI tool");
  });

  it("uses ATLAS_LLM_TRIAGE_MODEL env var when set", async () => {
    let capturedOptions: unknown;
    const stub = {
      completeWithToolUse: async (_messages: unknown[], options: unknown) => {
        capturedOptions = options;
        return { input: { mode: "single-ritual", reasoning: "env model" } };
      }
    } as unknown as LLMProvider;

    const original = process.env.ATLAS_LLM_TRIAGE_MODEL;
    process.env.ATLAS_LLM_TRIAGE_MODEL = "anthropic/claude-haiku-4-5";
    try {
      await classifyEntry({ prompt: "test" }, stub);
      expect((capturedOptions as { model: string }).model).toBe(
        "anthropic/claude-haiku-4-5"
      );
    } finally {
      if (original === undefined) {
        delete process.env.ATLAS_LLM_TRIAGE_MODEL;
      } else {
        process.env.ATLAS_LLM_TRIAGE_MODEL = original;
      }
    }
  });

  it("falls back to google/gemini-2.5-flash when ATLAS_LLM_TRIAGE_MODEL is not set", async () => {
    let capturedOptions: unknown;
    const stub = {
      completeWithToolUse: async (_messages: unknown[], options: unknown) => {
        capturedOptions = options;
        return { input: { mode: "single-ritual", reasoning: "default model" } };
      }
    } as unknown as LLMProvider;

    const original = process.env.ATLAS_LLM_TRIAGE_MODEL;
    delete process.env.ATLAS_LLM_TRIAGE_MODEL;
    try {
      await classifyEntry({ prompt: "test" }, stub);
      expect((capturedOptions as { model: string }).model).toBe(
        "google/gemini-2.5-flash"
      );
    } finally {
      if (original !== undefined) {
        process.env.ATLAS_LLM_TRIAGE_MODEL = original;
      }
    }
  });
});
