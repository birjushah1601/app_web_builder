import { z } from "zod";

export const CacheControlSchema = z.object({
  type: z.literal("ephemeral")
});
export type CacheControl = z.infer<typeof CacheControlSchema>;

export const LLMMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
  cache_control: CacheControlSchema.optional()
});
export type LLMMessage = z.infer<typeof LLMMessageSchema>;

export const LLMCallOptionsSchema = z.object({
  model: z.string(),
  maxTokens: z.number().int().positive().max(200000),
  temperature: z.number().min(0).max(2).optional(),
  stopSequences: z.array(z.string()).optional(),
  retry: z.enum(["default", "none", "strict"]).optional()
});
export type LLMCallOptions = z.infer<typeof LLMCallOptionsSchema>;

export const LLMUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative().optional(),
  cacheReadInputTokens: z.number().int().nonnegative().optional()
});
export type LLMUsage = z.infer<typeof LLMUsageSchema>;

export const LLMCompletionSchema = z.object({
  content: z.string(),
  model: z.string(),
  stopReason: z.enum(["end_turn", "max_tokens", "stop_sequence", "tool_use"]),
  usage: LLMUsageSchema
});
export type LLMCompletion = z.infer<typeof LLMCompletionSchema>;

export type LLMStreamChunk =
  | { type: "content_delta"; delta: string }
  | { type: "usage"; usage: LLMUsage }
  | { type: "message_stop"; stopReason: LLMCompletion["stopReason"] };

export interface LLMProvider {
  readonly name: string; // "anthropic" | "google"
  complete(messages: LLMMessage[], options: LLMCallOptions): Promise<LLMCompletion>;
  stream(messages: LLMMessage[], options: LLMCallOptions): AsyncIterable<LLMStreamChunk>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolUseResult {
  toolName: string;
  input: unknown;
  stopReason: LLMCompletion["stopReason"];
  usage: LLMCompletion["usage"];
}

export interface ToolUseOptions extends LLMCallOptions {
  tools: ToolDefinition[];
  toolChoice: { type: "tool"; name: string } | { type: "any" } | { type: "auto" };
}
