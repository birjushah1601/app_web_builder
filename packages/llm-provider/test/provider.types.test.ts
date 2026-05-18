import { describe, it, expectTypeOf } from "vitest";
import type { LLMProvider, LLMMessage, LLMCompletion, LLMStreamChunk, LLMCallOptions } from "../src/provider.js";

describe("LLMProvider types", () => {
  it("LLMMessage accepts user + assistant + system + cache_control", () => {
    const sys: LLMMessage = { role: "system", content: "you are helpful", cache_control: { type: "ephemeral" } };
    const usr: LLMMessage = { role: "user", content: "hello" };
    const asst: LLMMessage = { role: "assistant", content: "hi" };
    expectTypeOf(sys).toMatchTypeOf<LLMMessage>();
    expectTypeOf(usr).toMatchTypeOf<LLMMessage>();
    expectTypeOf(asst).toMatchTypeOf<LLMMessage>();
  });

  it("LLMCallOptions has model, maxTokens, retry override", () => {
    const opts: LLMCallOptions = {
      model: "claude-sonnet-4-6",
      maxTokens: 1024,
      retry: "default"
    };
    expectTypeOf(opts.retry).toEqualTypeOf<"default" | "none" | "strict" | undefined>();
  });

  it("LLMProvider.complete returns Promise<LLMCompletion>", () => {
    type CompleteFn = LLMProvider["complete"];
    expectTypeOf<CompleteFn>().returns.toMatchTypeOf<Promise<LLMCompletion>>();
  });

  it("LLMProvider.stream returns AsyncIterable<LLMStreamChunk>", () => {
    type StreamFn = LLMProvider["stream"];
    expectTypeOf<StreamFn>().returns.toMatchTypeOf<AsyncIterable<LLMStreamChunk>>();
  });
});
