import type Anthropic from "@anthropic-ai/sdk";
import { CircuitBreaker } from "./circuit-breaker.js";
import { InvalidRequestError, NetworkError, ProviderError, RateLimitError } from "./errors.js";
import { instrumentCall, type ProviderMetrics } from "./observability.js";
import type { LLMCallOptions, LLMCompletion, LLMMessage, LLMProvider, LLMStreamChunk, ToolUseOptions, ToolUseResult } from "./provider.js";
import { resolvePolicy, retry } from "./retry.js";

export interface AnthropicProviderOptions {
  sdk: Anthropic;
  metrics: ProviderMetrics;
  circuitBreakers?: Map<string, CircuitBreaker>;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly sdk: Anthropic;
  private readonly metrics: ProviderMetrics;
  private readonly breakers: Map<string, CircuitBreaker>;

  constructor(opts: AnthropicProviderOptions) {
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

  async completeWithToolUse(messages: LLMMessage[], options: ToolUseOptions): Promise<ToolUseResult> {
    const breaker = this.getBreaker(options.model);
    const policy = resolvePolicy(options.retry);
    return instrumentCall(
      { provider: this.name, model: options.model, metrics: this.metrics },
      () => breaker.run(() => retry(() => this.callWithToolUse(messages, options), policy))
    );
  }

  private async callWithToolUse(messages: LLMMessage[], options: ToolUseOptions): Promise<ToolUseResult> {
    try {
      const { system, body } = this.assembleRequest(messages, options);
      const req = {
        system,
        ...body,
        tools: options.tools,
        tool_choice: options.toolChoice
      };
      const resp = await this.sdk.messages.create(req as never) as unknown as AnthropicRawResponse;
      const toolUse = resp.content.find((c) => c.type === "tool_use");
      if (!toolUse || !toolUse.name || toolUse.input === undefined) {
        throw new InvalidRequestError(
          `expected tool_use response, got stop_reason=${resp.stop_reason}; content has no tool_use block`
        );
      }
      return {
        toolName: toolUse.name,
        input: toolUse.input,
        stopReason: resp.stop_reason,
        usage: {
          inputTokens: resp.usage.input_tokens,
          outputTokens: resp.usage.output_tokens,
          cacheCreationInputTokens: resp.usage.cache_creation_input_tokens,
          cacheReadInputTokens: resp.usage.cache_read_input_tokens
        }
      };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async *stream(messages: LLMMessage[], options: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    const { system, body } = this.assembleRequest(messages, options);
    const stream = this.sdk.messages.stream({ system, ...body } as never);
    for await (const event of stream) {
      const raw = event as unknown as Record<string, unknown>;
      const kind = raw.type as string | undefined;
      if (kind === "content_block_delta") {
        const delta = (raw.delta as Record<string, unknown>)?.text as string | undefined;
        if (delta) yield { type: "content_delta", delta };
      } else if (kind === "message_delta") {
        const stop = (raw.delta as Record<string, unknown>)?.stop_reason as LLMCompletion["stopReason"] | undefined;
        if (stop) yield { type: "message_stop", stopReason: stop };
      }
    }
  }

  private async callComplete(messages: LLMMessage[], options: LLMCallOptions): Promise<LLMCompletion> {
    try {
      const { system, body } = this.assembleRequest(messages, options);
      const resp = await this.sdk.messages.create({ system, ...body } as never) as unknown as AnthropicRawResponse;
      return this.parseResponse(resp);
    } catch (err) {
      throw this.translateError(err);
    }
  }

  private assembleRequest(messages: LLMMessage[], options: LLMCallOptions): { system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>; body: Record<string, unknown> } {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => ({
        type: "text" as const,
        text: m.content,
        ...(m.cache_control ? { cache_control: m.cache_control } : {})
      }));
    const userAssistant = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    return {
      system,
      body: {
        model: options.model,
        max_tokens: options.maxTokens,
        messages: userAssistant,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.stopSequences ? { stop_sequences: options.stopSequences } : {})
      }
    };
  }

  private parseResponse(raw: AnthropicRawResponse): LLMCompletion {
    const textBlocks = raw.content.filter((b): b is { type: "text"; text: string } => b.type === "text");
    const content = textBlocks.map((b) => b.text).join("");
    return {
      content,
      model: raw.model,
      stopReason: raw.stop_reason,
      usage: {
        inputTokens: raw.usage.input_tokens,
        outputTokens: raw.usage.output_tokens,
        cacheCreationInputTokens: raw.usage.cache_creation_input_tokens,
        cacheReadInputTokens: raw.usage.cache_read_input_tokens
      }
    };
  }

  private translateError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;
    const e = err as { status?: number; message?: string };
    const msg = e.message ?? "anthropic error";
    if (e.status === 429) return new RateLimitError(msg, { cause: err });
    if (e.status !== undefined && e.status >= 500) return new NetworkError(msg, { cause: err });
    if (e.status !== undefined && e.status >= 400) return new InvalidRequestError(msg, { cause: err });
    return new NetworkError(msg, { cause: err });
  }

  private getBreaker(model: string): CircuitBreaker {
    const key = `${this.name}:${model}`;
    let existing = this.breakers.get(key);
    if (!existing) {
      existing = new CircuitBreaker({ key, openAfter: 5, halfOpenAfterMs: 30_000 });
      this.breakers.set(key, existing);
    }
    return existing;
  }
}

interface AnthropicRawResponse {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  model: string;
  stop_reason: LLMCompletion["stopReason"];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}
