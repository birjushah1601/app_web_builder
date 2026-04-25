import { describe, it, expect, vi } from "vitest";
import { OpenAICompatProvider } from "@/lib/engine/openai-compat-provider";
import type { ToolDefinition } from "@atlas/llm-provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const TOOL: ToolDefinition = {
  name: "propose_plan",
  description: "Architect's deep-plan output.",
  input_schema: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"]
  }
};

describe("OpenAICompatProvider — URL normalization", () => {
  it("strips trailing slash from baseUrl", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "ok" } }], usage: {} })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://127.0.0.1:3456/",
      apiKey: "sk-no-auth",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await p.complete([{ role: "user", content: "hi" }], { model: "claude-sonnet-4", maxTokens: 100 });
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3456/v1/chat/completions");
  });

  it("strips a trailing /v1 from baseUrl before appending /v1/chat/completions", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "ok" } }], usage: {} })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://127.0.0.1:3456/v1",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await p.complete([{ role: "user", content: "hi" }], { model: "claude-sonnet-4", maxTokens: 100 });
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3456/v1/chat/completions");
  });
});

describe("OpenAICompatProvider — auth + fetch wiring", () => {
  it("sends Bearer auth + JSON content-type", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "ok" } }], usage: {} })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      apiKey: "sk-custom-key",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await p.complete([{ role: "user", content: "hi" }], { model: "claude-sonnet-4", maxTokens: 100 });
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-custom-key");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.accept).toBe("application/json");
    expect(init.method).toBe("POST");
  });

  it("defaults apiKey to sk-no-auth when not supplied", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "ok" } }], usage: {} })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await p.complete([{ role: "user", content: "hi" }], { model: "claude-sonnet-4", maxTokens: 100 });
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-no-auth");
  });

  it("raises a clear error on HTTP non-2xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("proxy is asleep", { status: 503 })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(
      p.complete([{ role: "user", content: "hi" }], { model: "claude-sonnet-4", maxTokens: 100 })
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("OpenAICompatProvider — complete()", () => {
  it("returns content, model, stopReason, and usage", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        model: "claude-sonnet-4",
        choices: [{ finish_reason: "stop", message: { content: "hello world" } }],
        usage: { prompt_tokens: 12, completion_tokens: 3 }
      })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    const res = await p.complete(
      [{ role: "user", content: "say hi" }],
      { model: "claude-sonnet-4", maxTokens: 100 }
    );
    expect(res.content).toBe("hello world");
    expect(res.model).toBe("claude-sonnet-4");
    expect(res.stopReason).toBe("stop_sequence");
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });

  it("maps finish_reason variants to Anthropic stopReason", async () => {
    const cases: Array<[string | undefined, string]> = [
      ["length", "max_tokens"],
      ["stop", "stop_sequence"],
      ["tool_calls", "tool_use"],
      ["content_filter", "end_turn"],
      ["function_call", "end_turn"],
      [undefined, "end_turn"],
      ["banana", "end_turn"] // unknown reasons fall through to end_turn
    ];
    for (const [input, expected] of cases) {
      const fetchFn = vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ finish_reason: input, message: { content: "" } }],
          usage: {}
        })
      );
      const p = new OpenAICompatProvider({
        baseUrl: "http://localhost:3456",
        fetchFn: fetchFn as unknown as typeof fetch
      });
      const res = await p.complete(
        [{ role: "user", content: "x" }],
        { model: "claude-sonnet-4", maxTokens: 100 }
      );
      expect(res.stopReason, `finish_reason=${input}`).toBe(expected);
    }
  });

  it("returns empty string content when the model omits content", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { } }], usage: {} })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    const res = await p.complete([{ role: "user", content: "x" }], { model: "claude-sonnet-4", maxTokens: 100 });
    expect(res.content).toBe("");
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("OpenAICompatProvider — completeWithToolUse()", () => {
  it("translates Anthropic ToolDefinition into OpenAI function shape", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  type: "function",
                  function: { name: "propose_plan", arguments: '{"summary":"do x"}' }
                }
              ]
            }
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    const res = await p.completeWithToolUse(
      [{ role: "user", content: "plan it" }],
      {
        model: "claude-sonnet-4",
        maxTokens: 100,
        tools: [TOOL],
        toolChoice: { type: "tool", name: "propose_plan" }
      }
    );

    expect(res.toolName).toBe("propose_plan");
    expect(res.input).toEqual({ summary: "do x" });
    expect(res.stopReason).toBe("tool_use");
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });

    // Verify the outgoing request shape
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      tools: Array<{ type: string; function: { name: string; parameters: unknown } }>;
      tool_choice: unknown;
    };
    expect(body.tools[0]).toEqual({
      type: "function",
      function: {
        name: "propose_plan",
        description: "Architect's deep-plan output.",
        parameters: TOOL.input_schema
      }
    });
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "propose_plan" } });
  });

  it("maps toolChoice.type='any' → 'required'", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                { type: "function", function: { name: "propose_plan", arguments: "{}" } }
              ]
            }
          }
        ],
        usage: {}
      })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await p.completeWithToolUse(
      [{ role: "user", content: "x" }],
      { model: "claude-sonnet-4", maxTokens: 100, tools: [TOOL], toolChoice: { type: "any" } }
    );
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { tool_choice: unknown };
    expect(body.tool_choice).toBe("required");
  });

  it("maps toolChoice.type='auto' → 'auto'", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                { type: "function", function: { name: "propose_plan", arguments: "{}" } }
              ]
            }
          }
        ],
        usage: {}
      })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await p.completeWithToolUse(
      [{ role: "user", content: "x" }],
      { model: "claude-sonnet-4", maxTokens: 100, tools: [TOOL], toolChoice: { type: "auto" } }
    );
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { tool_choice: unknown };
    expect(body.tool_choice).toBe("auto");
  });

  it("throws when the proxy returns no tool_call despite toolChoice.type='tool'", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [
          { finish_reason: "stop", message: { content: "I refused to call the tool" } }
        ],
        usage: {}
      })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(
      p.completeWithToolUse(
        [{ role: "user", content: "x" }],
        {
          model: "claude-sonnet-4",
          maxTokens: 100,
          tools: [TOOL],
          toolChoice: { type: "tool", name: "propose_plan" }
        }
      )
    ).rejects.toThrow(/expected a tool_call/);
  });

  it("throws a clear error when tool arguments are not valid JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                { type: "function", function: { name: "propose_plan", arguments: "{broken json" } }
              ]
            }
          }
        ],
        usage: {}
      })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(
      p.completeWithToolUse(
        [{ role: "user", content: "x" }],
        {
          model: "claude-sonnet-4",
          maxTokens: 100,
          tools: [TOOL],
          toolChoice: { type: "tool", name: "propose_plan" }
        }
      )
    ).rejects.toThrow(/tool arguments not JSON/);
  });

  it("falls back to empty object when tool arguments are the literal empty string", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                { type: "function", function: { name: "propose_plan", arguments: "" } }
              ]
            }
          }
        ],
        usage: {}
      })
    );
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: fetchFn as unknown as typeof fetch
    });
    const res = await p.completeWithToolUse(
      [{ role: "user", content: "x" }],
      { model: "claude-sonnet-4", maxTokens: 100, tools: [TOOL], toolChoice: { type: "tool", name: "propose_plan" } }
    );
    expect(res.input).toEqual({});
  });
});

describe("OpenAICompatProvider — stream()", () => {
  it("is not yet implemented", async () => {
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: vi.fn() as unknown as typeof fetch
    });
    const iter = p.stream([{ role: "user", content: "x" }], { model: "claude-sonnet-4", maxTokens: 100 });
    // Attempting to pull the first chunk should reject with the unimplemented error.
    await expect((async () => {
      for await (const _chunk of iter) break;
    })()).rejects.toThrow(/not yet implemented/);
  });
});

describe("OpenAICompatProvider — name", () => {
  it("has stable name='openai-compat' for logging/metrics", () => {
    const p = new OpenAICompatProvider({
      baseUrl: "http://localhost:3456",
      fetchFn: vi.fn() as unknown as typeof fetch
    });
    expect(p.name).toBe("openai-compat");
  });
});
