import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { synthesizeDag, PLANNER_SYNTH_MODEL } from "../src/synthesize-dag.js";
import type { PlannerTriageReport } from "../src/types.js";

const PASSED_TRIAGE: PlannerTriageReport = { passed: true, questions: [] };

function makeProvider(toolInput: unknown, toolName = "emit_dag") {
  const sdkCreate = vi.fn(async () => ({
    content: [{ type: "tool_use", id: "tu_1", name: toolName, input: toolInput }],
    model: PLANNER_SYNTH_MODEL,
    stop_reason: "tool_use",
    usage: { input_tokens: 100, output_tokens: 200 }
  }));
  const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
  return {
    provider: new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) }),
    sdkCreate
  };
}

describe("synthesizeDag — Task 7", () => {
  it("returns parsed 2-node DAG when LLM emits valid payload", async () => {
    const { provider, sdkCreate } = makeProvider({
      nodes: [
        { id: "backend", artifactKind: "backend-rest-api", summary: "REST API", dependsOn: [], consumes: [] },
        { id: "frontend", artifactKind: "frontend-app", summary: "React SPA", dependsOn: ["backend"], consumes: ["backend"] }
      ],
      dependencyProfile: {
        schemaVersion: "1",
        auth: { provider: "keycloak" },
        db: { provider: "postgres", connectionStringEnvVar: "DATABASE_URL" }
      },
      reasoning: "Separated API from UI for independent scaling"
    });

    const output = await synthesizeDag({
      userTurn: "build a SaaS platform with REST API and React frontend",
      triageReport: PASSED_TRIAGE,
      llm: provider
    });

    expect(output.nodes).toHaveLength(2);
    expect(output.nodes[0].id).toBe("backend");
    expect(output.nodes[0].artifactKind).toBe("backend-rest-api");
    expect(output.nodes[1].dependsOn).toContain("backend");
    expect(output.nodes[1].consumes).toContain("backend");
    expect(output.dependencyProfile.schemaVersion).toBe("1");
    expect(output.dependencyProfile.auth?.provider).toBe("keycloak");
    expect(output.reasoning).toContain("API");

    const call = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.model).toBe(PLANNER_SYNTH_MODEL);
    const tools = call.tools as Array<{ name: string }>;
    expect(tools[0].name).toBe("emit_dag");
  });

  it("throws DagSynthesisFailedError when LLM returns unknown artifactKind", async () => {
    const { provider } = makeProvider({
      nodes: [
        {
          id: "n1",
          artifactKind: "mobile-app", // not in ALLOWED_ARTIFACT_KINDS for DAG synthesis
          summary: "Mobile app",
          dependsOn: [],
          consumes: []
        }
      ],
      dependencyProfile: { schemaVersion: "1" },
      reasoning: "mobile"
    });

    await expect(
      synthesizeDag({ userTurn: "build a mobile app", triageReport: PASSED_TRIAGE, llm: provider })
    ).rejects.toThrow(/DagSynthesisFailedError|schema validation|Invalid enum value/i);
  });

  it("embeds OSS-first defaults context in the system prompt", async () => {
    const { provider, sdkCreate } = makeProvider({
      nodes: [
        { id: "backend", artifactKind: "backend-rest-api", summary: "API", dependsOn: [], consumes: [] }
      ],
      dependencyProfile: { schemaVersion: "1" },
      reasoning: "simple"
    });

    await synthesizeDag({ userTurn: "build something", triageReport: PASSED_TRIAGE, llm: provider });

    const call = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    // Anthropic SDK: system messages sent as top-level `system` field (string or array)
    const sysField = call.system as string | Array<{ text: string }> | undefined;
    const sysText = Array.isArray(sysField)
      ? sysField.map((b) => b.text).join(" ")
      : (sysField ?? "");
    expect(sysText).toContain("keycloak");
    expect(sysText).toContain("postgres");
  });

  it("validates that nodes list must be non-empty", async () => {
    const { provider } = makeProvider({
      nodes: [],
      dependencyProfile: { schemaVersion: "1" },
      reasoning: "empty"
    });

    await expect(
      synthesizeDag({ userTurn: "build something", triageReport: PASSED_TRIAGE, llm: provider })
    ).rejects.toThrow(/DagSynthesisFailedError|schema validation/i);
  });
});
