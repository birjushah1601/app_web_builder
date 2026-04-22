import type {
  LLMMessage,
  LLMCallOptions,
  LLMCompletion,
  LLMProvider,
  LLMStreamChunk,
  ToolDefinition
} from "@atlas/llm-provider";

interface ToolUseResultShape {
  toolName: string;
  input: unknown;
  stopReason: LLMCompletion["stopReason"];
  usage: LLMCompletion["usage"];
}

interface ToolUseOptionsShape extends LLMCallOptions {
  tools: ToolDefinition[];
  toolChoice: { type: "tool"; name: string } | { type: "any" } | { type: "auto" };
}

export interface OpenAICompatProviderOptions {
  /** Base URL of the OpenAI-compatible endpoint (e.g., http://127.0.0.1:3456). No trailing /v1. */
  baseUrl: string;
  /** API key — can be a placeholder when the proxy is unauth (e.g., the local CC CLI). */
  apiKey?: string;
  /** Optional fetch override for tests. */
  fetchFn?: typeof fetch;
}

/**
 * Adapter that exposes the @atlas/llm-provider LLMProvider shape (including
 * the architect-role-specific completeWithToolUse) backed by an OpenAI-style
 * /v1/chat/completions endpoint. Used to proxy through the local Claude
 * Code CLI server (`claude --serve`), which exposes Claude under an
 * OpenAI-compatible surface.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly name = "openai-compat";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: OpenAICompatProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
    this.apiKey = opts.apiKey ?? "sk-no-auth";
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async complete(messages: LLMMessage[], options: LLMCallOptions): Promise<LLMCompletion> {
    const res = await this.post({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stop: options.stopSequences,
      messages: toOpenAiMessages(messages)
    });
    const choice = res.choices?.[0];
    return {
      content: typeof choice?.message?.content === "string" ? choice.message.content : "",
      model: typeof res.model === "string" ? res.model : options.model,
      stopReason: mapStopReason(choice?.finish_reason),
      usage: extractUsage(res)
    };
  }

  async *stream(_messages: LLMMessage[], _options: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    throw new Error("OpenAICompatProvider.stream not yet implemented");
  }

  async completeWithToolUse(
    messages: LLMMessage[],
    options: ToolUseOptionsShape
  ): Promise<ToolUseResultShape> {
    const tools = options.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }));
    const toolChoice =
      options.toolChoice.type === "tool"
        ? { type: "function" as const, function: { name: options.toolChoice.name } }
        : options.toolChoice.type === "any"
          ? "required"
          : "auto";

    const res = await this.post({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stop: options.stopSequences,
      messages: toOpenAiMessages(messages),
      tools,
      tool_choice: toolChoice
    });

    const choice = res.choices?.[0];
    const toolCall = choice?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.type !== "function") {
      throw new Error(
        `OpenAICompatProvider: expected a tool_call in the response (forced toolChoice), got ${JSON.stringify(choice?.message)}`
      );
    }
    let input: unknown = {};
    try {
      input = JSON.parse(toolCall.function.arguments ?? "{}");
    } catch (err) {
      throw new Error(
        `OpenAICompatProvider: tool arguments not JSON: ${(err as Error).message}`
      );
    }
    return {
      toolName: toolCall.function.name,
      input,
      stopReason: mapStopReason(choice?.finish_reason),
      usage: extractUsage(res)
    };
  }

  private async post(body: Record<string, unknown>): Promise<OpenAiChatResponse> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAICompatProvider HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return (await res.json()) as OpenAiChatResponse;
  }
}

interface OpenAiChatResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      tool_calls?: Array<{
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function toOpenAiMessages(
  messages: LLMMessage[]
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : ""
  }));
}

function mapStopReason(reason: string | undefined): LLMCompletion["stopReason"] {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop":
      return "stop_sequence";
    case "content_filter":
    case "function_call":
    case undefined:
    default:
      return "end_turn";
  }
}

function extractUsage(res: OpenAiChatResponse): LLMCompletion["usage"] {
  return {
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0
  };
}
