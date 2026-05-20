import { describe, it, expect, vi } from "vitest";
import { RoutingProvider, rewriteClaudeModel } from "@/lib/engine/routing-provider";
import { OpenAICompatProvider } from "@/lib/engine/openai-compat-provider";
import type { ToolDefinition } from "@atlas/llm-provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeProvider(fetchFn: ReturnType<typeof vi.fn>, baseUrl: string) {
  return new OpenAICompatProvider({
    baseUrl,
    apiKey: "sk-no-auth",
    fetchFn: fetchFn as unknown as typeof fetch
  });
}

const completionBody = (model = "claude-sonnet-4") => ({
  model,
  choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1 }
});

const toolCallBody = (toolName: string, args: object) => ({
  choices: [
    {
      finish_reason: "tool_calls",
      message: {
        content: "",
        tool_calls: [
          { type: "function", function: { name: toolName, arguments: JSON.stringify(args) } }
        ]
      }
    }
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1 }
});

const PROPOSE: ToolDefinition = {
  name: "propose_plan",
  description: "x",
  input_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] }
};

describe("rewriteClaudeModel — maps OpenRouter-style IDs to local proxy IDs", () => {
  it.each([
    ["anthropic/claude-sonnet-4.5", "claude-sonnet-4"],
    ["anthropic/claude-haiku-4.5", "claude-haiku-4"],
    ["anthropic/claude-opus-4.5", "claude-opus-4"],
    ["anthropic/claude-sonnet-4", "claude-sonnet-4"],
    ["claude-sonnet-4.5", "claude-sonnet-4"],
    ["claude-haiku-4", "claude-haiku-4"]
  ])("%s → %s", (input, expected) => {
    expect(rewriteClaudeModel(input)).toBe(expected);
  });

  it("leaves non-Claude model strings unchanged", () => {
    expect(rewriteClaudeModel("google/gemini-2.5-flash")).toBe("google/gemini-2.5-flash");
  });
});

describe("RoutingProvider — complete()", () => {
  it("routes anthropic/* to the Claude provider with rewritten model ID", async () => {
    const primaryFetch = vi.fn();
    const claudeFetch = vi.fn().mockResolvedValue(jsonResponse(completionBody()));
    const router = new RoutingProvider({
      primary: makeProvider(primaryFetch, "https://openrouter.ai/api/v1"),
      claude: makeProvider(claudeFetch, "http://127.0.0.1:3456")
    });

    await router.complete([{ role: "user", content: "hi" }], {
      model: "anthropic/claude-sonnet-4.5",
      maxTokens: 100
    });

    expect(primaryFetch).not.toHaveBeenCalled();
    expect(claudeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = claudeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3456/v1/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("claude-sonnet-4");
  });

  it("routes bare claude-* (no vendor prefix) to the Claude provider", async () => {
    const primaryFetch = vi.fn();
    const claudeFetch = vi.fn().mockResolvedValue(jsonResponse(completionBody()));
    const router = new RoutingProvider({
      primary: makeProvider(primaryFetch, "https://openrouter.ai/api/v1"),
      claude: makeProvider(claudeFetch, "http://127.0.0.1:3456")
    });

    await router.complete([{ role: "user", content: "hi" }], {
      model: "claude-haiku-4",
      maxTokens: 100
    });

    expect(primaryFetch).not.toHaveBeenCalled();
    expect(claudeFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((claudeFetch.mock.calls[0] as [string, RequestInit])[1].body as string).model).toBe(
      "claude-haiku-4"
    );
  });

  it("routes non-Claude models (google/*, meta-llama/*) to the primary provider", async () => {
    const primaryFetch = vi.fn().mockResolvedValue(jsonResponse(completionBody("gemini-2.5-flash")));
    const claudeFetch = vi.fn();
    const router = new RoutingProvider({
      primary: makeProvider(primaryFetch, "https://openrouter.ai/api/v1"),
      claude: makeProvider(claudeFetch, "http://127.0.0.1:3456")
    });

    await router.complete([{ role: "user", content: "hi" }], {
      model: "google/gemini-2.5-flash",
      maxTokens: 100
    });

    expect(claudeFetch).not.toHaveBeenCalled();
    expect(primaryFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((primaryFetch.mock.calls[0] as [string, RequestInit])[1].body as string).model).toBe(
      "google/gemini-2.5-flash"
    );
  });

  it("falls back to primary when claude provider is null", async () => {
    const primaryFetch = vi.fn().mockResolvedValue(jsonResponse(completionBody()));
    const router = new RoutingProvider({
      primary: makeProvider(primaryFetch, "https://openrouter.ai/api/v1"),
      claude: null
    });

    await router.complete([{ role: "user", content: "hi" }], {
      model: "anthropic/claude-sonnet-4.5",
      maxTokens: 100
    });

    expect(primaryFetch).toHaveBeenCalledTimes(1);
  });
});

describe("RoutingProvider — completeWithToolUse()", () => {
  it("routes anthropic/* tool-use calls to the Claude provider with rewritten model", async () => {
    const primaryFetch = vi.fn();
    const claudeFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(toolCallBody("propose_plan", { summary: "x" })));
    const router = new RoutingProvider({
      primary: makeProvider(primaryFetch, "https://openrouter.ai/api/v1"),
      claude: makeProvider(claudeFetch, "http://127.0.0.1:3456")
    });

    const res = await router.completeWithToolUse(
      [{ role: "user", content: "hi" }],
      {
        model: "anthropic/claude-haiku-4.5",
        maxTokens: 100,
        tools: [PROPOSE],
        toolChoice: { type: "tool", name: "propose_plan" }
      }
    );

    expect(primaryFetch).not.toHaveBeenCalled();
    expect(claudeFetch).toHaveBeenCalled();
    const [url, init] = claudeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3456/v1/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("claude-haiku-4");
    expect(res.toolName).toBe("propose_plan");
  });

  it("routes non-Claude tool-use calls to the primary provider unmodified", async () => {
    const primaryFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(toolCallBody("propose_plan", { summary: "x" })));
    const claudeFetch = vi.fn();
    const router = new RoutingProvider({
      primary: makeProvider(primaryFetch, "https://openrouter.ai/api/v1"),
      claude: makeProvider(claudeFetch, "http://127.0.0.1:3456")
    });

    await router.completeWithToolUse(
      [{ role: "user", content: "hi" }],
      {
        model: "google/gemini-2.5-flash",
        maxTokens: 100,
        tools: [PROPOSE],
        toolChoice: { type: "tool", name: "propose_plan" }
      }
    );

    expect(claudeFetch).not.toHaveBeenCalled();
    expect(primaryFetch).toHaveBeenCalled();
    expect(
      JSON.parse((primaryFetch.mock.calls[0] as [string, RequestInit])[1].body as string).model
    ).toBe("google/gemini-2.5-flash");
  });
});
