import type {
  LLMMessage,
  LLMCallOptions,
  LLMCompletion,
  LLMProvider,
  LLMStreamChunk,
  ToolDefinition
} from "@atlas/llm-provider";
import { getModelCapabilities } from "@/lib/llm/model-capabilities";

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

    // Some OpenAI-compatible proxies (notably claude-max-api-proxy that wraps
    // the Claude CLI) silently DROP the `tools` array when forwarding to the
    // underlying model. The model never sees the tool schema and replies with
    // free-form text, so there's no `tool_calls` in the response and forced
    // toolChoice has no effect. To survive that, we ALSO inline the schema
    // into a synthetic system message — the model then knows what JSON shape
    // to emit, and we parse it from `content` when `tool_calls` is absent.
    // Native-tools-supporting proxies see the duplicate hint as redundant
    // (still works) and use the structured tool_calls path as before.
    const augmentedMessages = options.toolChoice.type === "tool"
      ? prependSchemaInstruction(messages, options.tools, options.toolChoice.name)
      : toOpenAiMessages(messages);

    // Up-front capability check: if we KNOW the model's hosted endpoint
    // doesn't support tool_use (e.g. Qwen 2.5 on OpenRouter), skip the
    // doomed request and go straight to the schema-injection path. This
    // both avoids a wasted round-trip and makes the test path deterministic.
    // Only meaningful when toolChoice forces a specific tool — otherwise
    // there's no schema to inject.
    const caps = getModelCapabilities(options.model);
    const skipToolsUpfront =
      !caps.supportsTools && options.toolChoice.type === "tool";

    const initialBody: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stop: options.stopSequences,
      messages: options.toolChoice.type === "tool" ? augmentedMessages : toOpenAiMessages(messages)
    };
    if (!skipToolsUpfront) {
      initialBody.tools = tools;
      initialBody.tool_choice = toolChoice;
    }

    let res: OpenAiChatResponse;
    try {
      res = await this.post(initialBody);
    } catch (err) {
      // Runtime 404-on-tools fallback. OpenRouter returns
      //   HTTP 404 {"error":{"message":"No endpoints found that support tool use"...}}
      // when the chosen model has no hosted endpoint that exposes tools.
      // We retry ONCE with `tools` + `tool_choice` stripped — the schema is
      // already inlined as a system message via prependSchemaInstruction
      // above, and extractJsonFromContent will recover the structured input
      // from the model's free-form reply on the existing fallback path.
      // Cap at one retry: if the schema-injection path also 404s, propagate.
      if (
        err instanceof OpenAICompatHttpError &&
        err.status === 404 &&
        /support tool use/i.test(err.body) &&
        options.toolChoice.type === "tool"
      ) {
        console.warn(
          `[openai-compat-provider] ${options.model} doesn't support tool_use, falling back to schema-injection`
        );
        const fallbackBody: Record<string, unknown> = {
          model: options.model,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          stop: options.stopSequences,
          messages: augmentedMessages
        };
        res = await this.post(fallbackBody);
      } else {
        throw err;
      }
    }

    const choice = res.choices?.[0];
    const toolCall = choice?.message?.tool_calls?.[0];

    // Native tool_calls path (proxies that DO support OpenAI tools).
    if (toolCall && toolCall.type === "function") {
      let input: unknown = {};
      const rawArgs = toolCall.function.arguments;
      if (rawArgs != null && rawArgs.trim() !== "") {
        try {
          input = JSON.parse(rawArgs);
        } catch (err) {
          throw new Error(
            `OpenAICompatProvider: tool arguments not JSON: ${(err as Error).message}`
          );
        }
      }
      return {
        toolName: toolCall.function.name,
        input,
        stopReason: mapStopReason(choice?.finish_reason),
        usage: extractUsage(res)
      };
    }

    // Fallback: parse JSON out of the content for proxies that drop tools.
    // Only viable when toolChoice forced a specific tool — that's how we
    // know which tool name to attribute and (via its input_schema) what
    // shape was instructed.
    if (options.toolChoice.type === "tool") {
      const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
      const parsed = extractJsonFromContent(content);
      if (parsed !== undefined) {
        return {
          toolName: options.toolChoice.name,
          input: parsed,
          stopReason: mapStopReason(choice?.finish_reason),
          usage: extractUsage(res)
        };
      }
    }

    throw new Error(
      `OpenAICompatProvider: expected a tool_call in the response (forced toolChoice), got ${JSON.stringify(choice?.message)}`
    );
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
      throw new OpenAICompatHttpError(res.status, text);
    }
    return (await res.json()) as OpenAiChatResponse;
  }

  /** Streaming variant of `completeWithToolUse`. POSTs with `stream: true`,
   *  parses OpenAI-compat SSE chunks, and invokes `onDelta(chunk)` for each
   *  content fragment as it arrives. Returns the final ToolUseResult after
   *  the stream completes (parsed via extractJsonFromContent — the proxy
   *  drops the `tools` array, so the model emits JSON in content rather
   *  than via tool_calls; this is the same fallback path completeWithToolUse
   *  takes today).
   *
   *  Used by role-developer's anthropic-pass when the engine wires a token
   *  callback; the callback is forwarded to the broker as
   *  `developer.candidate.delta` SSE events so the canvas UI can render the
   *  diff as it grows. */
  async completeWithToolUseStreaming(
    messages: LLMMessage[],
    options: ToolUseOptionsShape,
    onDelta: (chunk: string) => void
  ): Promise<ToolUseResultShape> {
    // We mirror the non-streaming path's schema-injection — the proxy drops
    // `tools` regardless of stream mode, so injecting the JSON Schema as a
    // system message is the only way the model knows what shape to emit.
    if (options.toolChoice.type !== "tool") {
      throw new Error(
        "OpenAICompatProvider.completeWithToolUseStreaming: only toolChoice.type='tool' is supported"
      );
    }
    const augmentedMessages = prependSchemaInstruction(messages, options.tools, options.toolChoice.name);
    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      stop: options.stopSequences,
      stream: true,
      messages: augmentedMessages
    };

    const res = await this.fetchFn(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok || !res.body) {
      const text = res.body ? await res.text().catch(() => "") : "";
      throw new OpenAICompatHttpError(res.status, text);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    let finishReason: string | undefined;
    let usage: OpenAiChatResponse["usage"];
    let modelEcho: string | undefined;
    // SSE parser: split on \n, each `data: ` line is a JSON chunk; blank
    // line ends an event; `data: [DONE]` terminates. Carry incomplete tail
    // between read() calls via `buffer`.
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trimStart();
        if (payload === "[DONE]") break outer;
        if (payload === "") continue;
        let chunk: {
          model?: string;
          choices?: Array<{
            delta?: { content?: string };
            finish_reason?: string | null;
          }>;
          usage?: OpenAiChatResponse["usage"];
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          // Malformed chunk — skip silently rather than tear down the stream.
          continue;
        }
        if (typeof chunk.model === "string" && modelEcho === undefined) modelEcho = chunk.model;
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          accumulated += delta;
          try {
            onDelta(delta);
          } catch {
            // A throwing onDelta must not break the stream — log-only.
          }
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      }
    }

    const parsed = extractJsonFromContent(accumulated);
    if (parsed === undefined) {
      throw new Error(
        `OpenAICompatProvider.completeWithToolUseStreaming: could not parse JSON from streamed content (length=${accumulated.length})`
      );
    }
    return {
      toolName: options.toolChoice.name,
      input: parsed,
      stopReason: mapStopReason(finishReason),
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0
      }
    };
  }
}

/**
 * Typed HTTP error so callers (notably completeWithToolUse) can distinguish
 * the OpenRouter "no endpoints support tool use" 404 from generic transport
 * failures. The Error message preserves the existing
 *   `OpenAICompatProvider HTTP <status>: <body>`
 * shape so log scrapers and existing tests keep working.
 */
export class OpenAICompatHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`OpenAICompatProvider HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "OpenAICompatHttpError";
    this.status = status;
    this.body = body;
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

/** Inject a synthetic system message instructing the model to respond with
 *  ONLY a JSON object matching the given tool's input_schema. Used as a
 *  fallback for OpenAI-compatible proxies that don't propagate the `tools`
 *  array to the underlying model. The instruction is prepended so it
 *  survives even when the caller's own messages include a `system` entry. */
function prependSchemaInstruction(
  messages: LLMMessage[],
  tools: ToolDefinition[],
  toolName: string
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) return toOpenAiMessages(messages);
  const schemaJson = JSON.stringify(tool.input_schema, null, 2);

  // Walk one level (and one level into discriminated-union variants under
  // anyOf/oneOf) to surface the required fields by name. Models against
  // proxies that strip the tools[] array tend to drop required fields when
  // the schema only LIVES in JSON; calling them out explicitly improves
  // compliance dramatically.
  const requiredHints = listRequiredFieldHints(tool.input_schema);

  const instruction =
    `You MUST respond with ONLY a single JSON object matching this exact JSON Schema, ` +
    `with no surrounding prose, no markdown code fences, no commentary. ` +
    `The schema describes the required structure of your response (this is the ` +
    `'${toolName}' tool's input).\n\n` +
    (requiredHints ? `REQUIRED FIELDS — your response MUST include all of these:\n${requiredHints}\n\n` : "") +
    `Full JSON Schema:\n\n${schemaJson}\n\n` +
    `Respond with the JSON object alone. The first character of your response must be '{'. ` +
    `If the schema is a discriminated union, pick exactly one variant (by its discriminator value) ` +
    `and include EVERY field that variant requires. Do not omit any required field.`;
  return [
    { role: "system", content: instruction },
    ...toOpenAiMessages(messages)
  ];
}

/** Best-effort traversal of a JSON Schema to produce a human-readable list of
 *  required field paths. Handles top-level required[] and one level of
 *  discriminated-union variants under anyOf/oneOf. Returns "" when the schema
 *  doesn't have a required-field signal we can extract. */
function listRequiredFieldHints(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "";
  const lines: string[] = [];

  const s = schema as { required?: string[]; properties?: Record<string, unknown>; anyOf?: unknown[]; oneOf?: unknown[] };

  // Top-level required
  if (Array.isArray(s.required) && s.required.length > 0) {
    lines.push(`- Top level: ${s.required.join(", ")}`);
  }

  // Discriminated-union variants
  const variants = (Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : []) as Array<{
    properties?: Record<string, unknown>;
    required?: string[];
  }>;
  for (const v of variants) {
    if (!v || typeof v !== "object") continue;
    const variantTag = pickVariantDiscriminatorLabel(v);
    if (Array.isArray(v.required) && v.required.length > 0) {
      lines.push(`- When ${variantTag}: ${v.required.join(", ")}`);
    }
  }

  return lines.join("\n");
}

/** For a discriminated-union variant like { properties: { scope: { const: "new-app" } } },
 *  return a string like 'scope = "new-app"'. Falls back to "this variant" when no
 *  recognizable discriminator. */
function pickVariantDiscriminatorLabel(variant: { properties?: Record<string, unknown> }): string {
  const props = variant.properties ?? {};
  for (const [key, value] of Object.entries(props)) {
    if (value && typeof value === "object") {
      const v = value as { const?: unknown; enum?: unknown[] };
      if (typeof v.const === "string") return `${key} = "${v.const}"`;
      if (Array.isArray(v.enum) && v.enum.length === 1 && typeof v.enum[0] === "string") {
        return `${key} = "${v.enum[0]}"`;
      }
    }
  }
  return "this variant";
}

/** Try to extract a JSON object from free-form content. Handles three forms
 *  the model commonly emits when asked for structured output:
 *    1. Bare JSON ({"foo": ...})
 *    2. Fenced ```json ... ``` block
 *    3. JSON embedded inside surrounding prose
 *  Returns undefined when no parseable JSON object is present. */
function extractJsonFromContent(content: string): unknown {
  if (!content) return undefined;
  const trimmed = content.trim();

  // Form 1: bare JSON object that starts with `{`
  if (trimmed.startsWith("{")) {
    const result = tryParse(trimmed);
    if (result !== undefined) return result;
  }

  // Form 2: fenced ```json or ``` block
  const fenceMatch = content.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch && fenceMatch[1]) {
    const result = tryParse(fenceMatch[1].trim());
    if (result !== undefined) return result;
  }

  // Form 3: first {...} object substring (prose-then-JSON or JSON-then-prose).
  // Use a balanced-brace scan rather than greedy regex so nested objects parse.
  const start = content.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < content.length; i++) {
    const c = content[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const candidate = content.slice(start, i + 1);
        const result = tryParse(candidate);
        if (result !== undefined) return result;
        break;
      }
    }
  }
  return undefined;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
