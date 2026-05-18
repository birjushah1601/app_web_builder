import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { GoogleProvider, createProviderMetrics } from "../src/index.js";

describe("GoogleProvider.complete", () => {
  it("calls Gemini SDK with mapped messages and returns LLMCompletion", async () => {
    const generateContent = vi.fn(async () => ({
      response: {
        text: () => "hello back",
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hello back" }] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6, totalTokenCount: 18 }
      }
    }));
    const getGenerativeModel = vi.fn(() => ({ generateContent }));
    const sdk = { getGenerativeModel } as never;

    const provider = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const result = await provider.complete(
      [{ role: "user", content: "say hi" }],
      { model: "gemini-2.5-flash", maxTokens: 256 }
    );

    expect(result.content).toBe("hello back");
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(6);
    expect(getGenerativeModel).toHaveBeenCalledWith({ model: "gemini-2.5-flash", generationConfig: { maxOutputTokens: 256 } });
  });

  it("translates Gemini API errors into ProviderError subclasses", async () => {
    const generateContent = vi.fn(async () => {
      const err: Error & { status?: number } = new Error("429 rate limited");
      err.status = 429;
      throw err;
    });
    const sdk = { getGenerativeModel: () => ({ generateContent }) } as never;
    const provider = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    await expect(provider.complete([{ role: "user", content: "hi" }], { model: "gemini-2.5-flash", maxTokens: 100 }))
      .rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("merges system messages into the first user turn (Gemini has no separate system role)", async () => {
    const generateContent = vi.fn(async () => ({
      response: { text: () => "ok", candidates: [{ finishReason: "STOP", content: { parts: [{ text: "ok" }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 } }
    }));
    const sdk = { getGenerativeModel: () => ({ generateContent }) } as never;
    const provider = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    await provider.complete(
      [
        { role: "system", content: "You are a coder" },
        { role: "system", content: "Output a unified diff" },
        { role: "user", content: "rename foo to bar" }
      ],
      { model: "gemini-2.5-flash", maxTokens: 256 }
    );

    const call = generateContent.mock.calls[0][0] as Record<string, unknown>;
    const contents = call.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe("user");
    const merged = contents[0].parts[0].text;
    expect(merged).toContain("You are a coder");
    expect(merged).toContain("Output a unified diff");
    expect(merged).toContain("rename foo to bar");
  });
});
