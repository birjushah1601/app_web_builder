import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getModelCapabilities,
  __resetUnknownWarningsForTests
} from "@/lib/llm/model-capabilities";

describe("getModelCapabilities", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetUnknownWarningsForTests();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("known models", () => {
    it("returns tool-supporting profile for Anthropic Claude family", () => {
      const haiku = getModelCapabilities("anthropic/claude-haiku-4.5");
      expect(haiku.supportsTools).toBe(true);
      expect(haiku.supportsVision).toBe(true);
      expect(haiku.contextWindow).toBeGreaterThanOrEqual(100_000);

      const sonnet = getModelCapabilities("anthropic/claude-sonnet-4.5");
      expect(sonnet.supportsTools).toBe(true);
      expect(sonnet.supportsVision).toBe(true);
    });

    it("returns tool-supporting profile for Gemini 2.5 Flash", () => {
      const flash = getModelCapabilities("google/gemini-2.5-flash");
      expect(flash.supportsTools).toBe(true);
      expect(flash.supportsVision).toBe(true);
      expect(flash.contextWindow).toBe(1_000_000);
    });

    it("returns tool-supporting profile for DeepSeek chat", () => {
      const deepseek = getModelCapabilities("deepseek/deepseek-chat");
      expect(deepseek.supportsTools).toBe(true);
      expect(deepseek.supportsVision).toBe(false);
    });

    it("flags Qwen 2.5 OpenRouter endpoints as NOT supporting tool_use", () => {
      // The bite that prompted this work: Qwen on OpenRouter 404s every
      // tool-use request. The registry must mark this explicitly so the
      // provider skips the doomed call up-front.
      const qwen72 = getModelCapabilities("qwen/qwen-2.5-72b-instruct");
      expect(qwen72.supportsTools).toBe(false);

      const qwenCoder = getModelCapabilities("qwen/qwen-2.5-coder-32b-instruct");
      expect(qwenCoder.supportsTools).toBe(false);
    });

    it("flags Llama 3.3 70b as NOT supporting tool_use on current OpenRouter hosts", () => {
      const llama = getModelCapabilities("meta-llama/llama-3.3-70b-instruct");
      expect(llama.supportsTools).toBe(false);
    });

    it("returns tool-supporting profile for OpenAI GPT-4o-mini", () => {
      const gpt = getModelCapabilities("openai/gpt-4o-mini");
      expect(gpt.supportsTools).toBe(true);
      expect(gpt.supportsVision).toBe(true);
    });

    it("does NOT log a warning for known models", () => {
      getModelCapabilities("anthropic/claude-haiku-4.5");
      getModelCapabilities("qwen/qwen-2.5-72b-instruct");
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("unknown models", () => {
    it("returns the conservative default profile", () => {
      const caps = getModelCapabilities("some-vendor/some-experimental-model-2099");
      expect(caps.supportsTools).toBe(true); // optimistic — most modern models do
      expect(caps.supportsVision).toBe(false);
      expect(caps.contextWindow).toBe(32_000);
    });

    it("logs a one-shot warning per unknown model", () => {
      getModelCapabilities("vendor-a/model-x");
      getModelCapabilities("vendor-a/model-x");
      getModelCapabilities("vendor-a/model-x");
      // Only ONE warning per unique model id — log spam protection.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0]![0] as string;
      expect(msg).toContain("vendor-a/model-x");
      expect(msg).toContain("model-capabilities");
    });

    it("warns separately for each distinct unknown model", () => {
      getModelCapabilities("vendor-b/model-y");
      getModelCapabilities("vendor-c/model-z");
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("local-proxy unprefixed names", () => {
    it("resolves Claude rebadged names used by the local proxy", () => {
      // claude-max-api-proxy serves Claude under "claude-sonnet-4" without
      // a vendor prefix. The registry needs to handle both forms.
      expect(getModelCapabilities("claude-haiku-4-5").supportsTools).toBe(true);
      expect(getModelCapabilities("claude-sonnet-4").supportsTools).toBe(true);
    });
  });
});
