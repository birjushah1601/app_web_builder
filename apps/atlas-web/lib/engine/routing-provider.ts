import type {
  LLMMessage,
  LLMCallOptions,
  LLMCompletion,
  LLMProvider,
  LLMStreamChunk,
  ToolDefinition
} from "@atlas/llm-provider";
import { OpenAICompatProvider } from "@/lib/engine/openai-compat-provider";

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

export interface RoutingProviderOptions {
  /** OpenRouter / external provider for non-Claude models. */
  primary: OpenAICompatProvider;
  /** Local Claude proxy. When null, all calls go to primary. */
  claude: OpenAICompatProvider | null;
}

/**
 * Local Claude Code CLI proxy lists `claude-{haiku,sonnet,opus}-4` (no `.5`
 * suffix, no vendor prefix). OpenRouter-style env strings like
 * `anthropic/claude-sonnet-4.5` must be normalized before hitting it.
 */
export function rewriteClaudeModel(model: string): string {
  if (!isClaudeModel(model)) return model;
  return model.replace(/^anthropic\//, "").replace(/\.5$/, "");
}

function isClaudeModel(model: string): boolean {
  return model.startsWith("anthropic/") || model.startsWith("claude-");
}

/**
 * Dispatches LLM calls between two OpenAI-compatible endpoints by model name:
 *   - `anthropic/claude-*` and bare `claude-*` → Claude provider (model rewritten)
 *   - everything else → primary provider (model unchanged)
 *
 * Enables a hybrid where Claude requests hit a free local proxy while the
 * non-Claude mix (Gemini, Llama, etc.) keeps using OpenRouter.
 */
export class RoutingProvider implements LLMProvider {
  readonly name = "routing";
  private readonly primary: OpenAICompatProvider;
  private readonly claude: OpenAICompatProvider | null;

  constructor(opts: RoutingProviderOptions) {
    this.primary = opts.primary;
    this.claude = opts.claude;
  }

  private pick(model: string): { provider: OpenAICompatProvider; model: string } {
    if (this.claude && isClaudeModel(model)) {
      return { provider: this.claude, model: rewriteClaudeModel(model) };
    }
    return { provider: this.primary, model };
  }

  complete(messages: LLMMessage[], options: LLMCallOptions): Promise<LLMCompletion> {
    const { provider, model } = this.pick(options.model);
    return provider.complete(messages, { ...options, model });
  }

  stream(messages: LLMMessage[], options: LLMCallOptions): AsyncIterable<LLMStreamChunk> {
    const { provider, model } = this.pick(options.model);
    return provider.stream(messages, { ...options, model });
  }

  completeWithToolUse(
    messages: LLMMessage[],
    options: ToolUseOptionsShape
  ): Promise<ToolUseResultShape> {
    const { provider, model } = this.pick(options.model);
    return provider.completeWithToolUse(messages, { ...options, model });
  }
}
