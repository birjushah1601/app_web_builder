import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { Conductor } from "../src/conductor.js";
import { TestRole, type RoleInvocation } from "../src/role.js";
import { MessageBus } from "../src/messaging.js";
import { SharedTaskList } from "../src/shared-task-list.js";
import { buildPromptCacheBlocks } from "../src/prompt-cache.js";

describe("integration: classify → role run → prompt-cache → llm-provider", () => {
  it("produces a classified, retried, completed dispatch that calls the mocked Anthropic SDK", async () => {
    // Mock the Anthropic SDK
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "text", text: "Developer says: done." }],
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 40 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    // Role that actually calls the provider through the prompt-cache assembler
    const role = new TestRole({
      roleId: "developer",
      onRun: async (inv: RoleInvocation) => {
        const blocks = buildPromptCacheBlocks({
          rolePrompt: "you are the Developer",
          graphSlice: inv.graphSlice,
          userTurn: inv.userTurn
        });
        const completion = await provider.complete(blocks, { model: "claude-sonnet-4-6", maxTokens: 1024 });
        return {
          events: [{ eventType: "developer.completion", payload: { text: completion.content } }],
          diff: { kind: "none" as const }
        };
      }
    });

    const bus = new MessageBus();
    const queue = new SharedTaskList<{ id: string; role: string }>();
    queue.enqueue({ id: "ritual-1", role: "developer" });

    const checkpoints: Array<{ eventType: string }> = [];
    const conductor = new Conductor({
      classifier: { classify: async () => ({ roleId: "developer", confidence: 0.95 }) },
      roles: new Map([["developer", role]]),
      checkpointSink: { emit: async (e) => { checkpoints.push(e); await bus.publish(e.eventType, e); } },
      sliceBuilder: () => ({ bytes: '{"nodes":[],"edges":[]}', hash: "sha256:zero" }),
      sleep: async () => {}
    });

    let sawCompletion = false;
    bus.subscribe<{ payload: { text: string } }>("developer.completion", (evt) => {
      if (evt.payload.text.includes("done")) sawCompletion = true;
    });

    const result = await conductor.dispatch({
      ritualId: "ritual-1" as never,
      graphVersion: 1,
      userTurn: "ship it",
      projectId: "11111111-1111-4111-8111-111111111111"
    });

    expect(result.roleId).toBe("developer");
    expect(result.output.events[0].eventType).toBe("developer.completion");
    expect(sdkCreate).toHaveBeenCalledOnce();
    const req = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    const sys = req.system as Array<Record<string, unknown>>;
    // 3-tier: role + graph slice in system, user turn in messages
    expect(sys).toHaveLength(2);
    expect((req.messages as Array<Record<string, unknown>>)[0]).toMatchObject({ role: "user", content: "ship it" });
    expect(sawCompletion).toBe(true);
    expect(checkpoints.some((c) => c.eventType === "dispatch.completed")).toBe(true);
  });
});
