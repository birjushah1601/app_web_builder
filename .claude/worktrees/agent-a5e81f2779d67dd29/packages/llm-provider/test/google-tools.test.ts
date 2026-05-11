import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { GoogleProvider, createProviderMetrics } from "../src/index.js";

describe("GoogleProvider.completeWithToolUse", () => {
  it("returns the tool_use input when the model calls the tool", async () => {
    const generateContent = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "emit_developer_output", args: { diff: "@@ +1 line", summary: "renamed", testsAdded: [], filesModified: ["a.ts"] } } }] } }],
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "@@ +1 line", summary: "renamed", testsAdded: [], filesModified: ["a.ts"] } }]
      }
    }));
    const sdk = { getGenerativeModel: () => ({ generateContent }) } as never;
    const provider = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const result = await provider.completeWithToolUse(
      [{ role: "user", content: "rename foo to bar" }],
      {
        model: "gemini-2.5-flash",
        maxTokens: 1024,
        tools: [{
          name: "emit_developer_output",
          description: "Emit the developer output",
          input_schema: {
            type: "object",
            properties: { diff: { type: "string" }, summary: { type: "string" }, testsAdded: { type: "array", items: { type: "string" } }, filesModified: { type: "array", items: { type: "string" } } },
            required: ["diff", "summary", "testsAdded", "filesModified"]
          }
        }],
        toolChoice: { type: "tool", name: "emit_developer_output" }
      }
    );

    expect(result.toolName).toBe("emit_developer_output");
    expect(result.input).toMatchObject({ diff: "@@ +1 line", summary: "renamed" });
  });

  it("throws when the model emits text without a function call", async () => {
    const generateContent = vi.fn(async () => ({
      response: {
        text: () => "I cannot use the tool",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
        functionCalls: () => []
      }
    }));
    const sdk = { getGenerativeModel: () => ({ generateContent }) } as never;
    const provider = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    await expect(provider.completeWithToolUse(
      [{ role: "user", content: "do it" }],
      {
        model: "gemini-2.5-flash", maxTokens: 100,
        tools: [{ name: "emit_developer_output", description: "x", input_schema: { type: "object", properties: {} } }],
        toolChoice: { type: "tool", name: "emit_developer_output" }
      }
    )).rejects.toThrow(/tool/);
  });
});
