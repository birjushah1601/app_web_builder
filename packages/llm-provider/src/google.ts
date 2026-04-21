import type { GoogleGenerativeAI } from "@google/generative-ai";
import { CircuitBreaker } from "./circuit-breaker.js";
import { InvalidRequestError, NetworkError, ProviderError, RateLimitError } from "./errors.js";
import { instrumentCall, type ProviderMetrics } from "./observability.js";
import type { LLMCallOptions, LLMCompletion, LLMMessage, LLMProvider, LLMStreamChunk, ToolUseOptions, ToolUseResult } from "./provider.js";
import { resolvePolicy, retry } from "./retry.js";

export interface GoogleProviderOptions {
  sdk: GoogleGenerativeAI;
  metrics: ProviderMetrics;
  circuitBreakers?: Map<string, CircuitBreaker>;
}

export class GoogleProvider implements LLMProvider {
  readonly name = "google";
  private readonly sdk: GoogleGenerativeAI;
  private readonly metrics: ProviderMetrics;
  private readonly breakers: Map<string, CircuitBreaker>;

  constructor(opts: GoogleProviderOptions) {
    this.sdk = opts.sdk;
    this.metrics = opts.metrics;
    this.breakers = opts.circuitBreakers ?? new Map();
  }

  async complete(messages: LLMMessage[], options: LLMCallOptions): Promise<LLMCompletion> {
    const breaker = this.getBreaker(options.model);
    const policy = resolvePolicy(options.retry);
    return instrumentCall(
      { provider: this.name, model: options.model, metrics: this.metrics },
      () => breaker.run(() => retry(() => this.callComplete(messages, options), policy))
    );
  }

  async *stream(_messages: LLMMessage[], _options: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    throw new Error("GoogleProvider.stream is not yet implemented (use complete for D.3 voting)");
    yield { type: "content_delta", delta: "" }; // unreachable; satisfies type
  }

  async completeWithToolUse(
    messages: LLMMessage[],
    options: ToolUseOptions
  ): Promise<ToolUseResult> {
    const breaker = this.getBreaker(options.model);
    const policy = resolvePolicy(options.retry);
    return instrumentCall(
      { provider: this.name, model: options.model, metrics: this.metrics },
      () => breaker.run(() => retry(() => this.callWithToolUse(messages, options), policy))
    );
  }

  private async callComplete(messages: LLMMessage[], options: LLMCallOptions): Promise<LLMCompletion> {
    try {
      const model = this.sdk.getGenerativeModel({
        model: options.model,
        generationConfig: {
          maxOutputTokens: options.maxTokens,
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {})
        }
      });
      const contents = mapMessages(messages);
      const resp = (await model.generateContent({ contents })) as unknown as GeminiRawResponse;
      return {
        content: resp.response.text(),
        model: options.model,
        stopReason: mapStopReason(resp.response.candidates?.[0]?.finishReason),
        usage: {
          inputTokens: resp.response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: resp.response.usageMetadata?.candidatesTokenCount ?? 0
        }
      };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  private async callWithToolUse(
    messages: LLMMessage[],
    options: ToolUseOptions
  ): Promise<ToolUseResult> {
    try {
      const model = this.sdk.getGenerativeModel({
        model: options.model,
        generationConfig: { maxOutputTokens: options.maxTokens },
        tools: [{
          functionDeclarations: options.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.input_schema as never
          }))
        }],
        toolConfig: options.toolChoice.type === "tool"
          ? { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [options.toolChoice.name] } }
          : { functionCallingConfig: { mode: "AUTO" } }
      });
      const contents = mapMessages(messages);
      const resp = (await model.generateContent({ contents })) as unknown as GeminiRawResponse & {
        response: { functionCalls?: () => Array<{ name: string; args: unknown }> | undefined };
      };
      const calls = resp.response.functionCalls?.() ?? [];
      const first = calls[0];
      if (!first) {
        throw new InvalidRequestError("expected tool/functionCall response, got plain text or empty");
      }
      return {
        toolName: first.name,
        input: first.args,
        stopReason: mapStopReason(resp.response.candidates?.[0]?.finishReason),
        usage: {
          inputTokens: resp.response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: resp.response.usageMetadata?.candidatesTokenCount ?? 0
        }
      };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  private translateError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    const e = err as { status?: number; message?: string };
    const msg = e.message ?? "google provider error";
    if (e.status === 429) return new RateLimitError(msg, { cause: err });
    if (e.status !== undefined && e.status >= 500) return new NetworkError(msg, { cause: err });
    if (e.status !== undefined && e.status >= 400) return new InvalidRequestError(msg, { cause: err });
    return new NetworkError(msg, { cause: err });
  }

  private getBreaker(model: string): CircuitBreaker {
    const key = `${this.name}:${model}`;
    let b = this.breakers.get(key);
    if (!b) {
      b = new CircuitBreaker({ key, openAfter: 5, halfOpenAfterMs: 30_000 });
      this.breakers.set(key, b);
    }
    return b;
  }
}

interface GeminiRawResponse {
  response: {
    text(): string;
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
}

function mapStopReason(reason: string | undefined): LLMCompletion["stopReason"] {
  switch (reason) {
    case "MAX_TOKENS": return "max_tokens";
    case "STOP": return "end_turn";
    case "STOP_SEQUENCE": return "stop_sequence";
    default: return "end_turn";
  }
}

function mapMessages(messages: LLMMessage[]): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  // Gemini has no system role. Merge all leading system messages into the first user turn.
  const systemTexts: string[] = [];
  const out: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  let firstUserHandled = false;
  for (const m of messages) {
    if (m.role === "system") {
      systemTexts.push(m.content);
      continue;
    }
    if (m.role === "user") {
      if (!firstUserHandled && systemTexts.length > 0) {
        out.push({ role: "user", parts: [{ text: [...systemTexts, m.content].join("\n\n") }] });
        firstUserHandled = true;
      } else {
        out.push({ role: "user", parts: [{ text: m.content }] });
      }
    } else {
      out.push({ role: "model", parts: [{ text: m.content }] });
    }
  }
  // If we never saw a user turn but had system messages, push them as a single user turn.
  if (!firstUserHandled && systemTexts.length > 0 && out.length === 0) {
    out.push({ role: "user", parts: [{ text: systemTexts.join("\n\n") }] });
  }
  return out;
}
