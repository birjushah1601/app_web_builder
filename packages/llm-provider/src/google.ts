import type { LLMCallOptions, LLMCompletion, LLMMessage, LLMProvider, LLMStreamChunk } from "./provider.js";

export interface GoogleProviderOptions {
  apiKey: string;
}

// D.1 stub. Real Gemini 2.5 Flash implementation lands with Plan D.3 (Developer-role parallelism).
export class GoogleProvider implements LLMProvider {
  readonly name = "google";
  constructor(_opts: GoogleProviderOptions) {
    // accepted for interface parity; no SDK wired in D.1
  }
  async complete(_messages: LLMMessage[], _options: LLMCallOptions): Promise<LLMCompletion> {
    throw new Error("GoogleProvider.complete is deferred to D.3 — use AnthropicProvider in D.1");
  }
  async *stream(_messages: LLMMessage[], _options: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    throw new Error("GoogleProvider.stream is deferred to D.3 — use AnthropicProvider in D.1");
    yield { type: "content_delta", delta: "" }; // unreachable but satisfies return type
  }
}
