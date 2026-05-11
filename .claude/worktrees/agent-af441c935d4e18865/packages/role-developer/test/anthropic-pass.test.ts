import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { anthropicPass, DEVELOPER_ANTHROPIC_MODEL } from "../src/anthropic-pass.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("anthropicPass", () => {
  it("calls completeWithToolUse with emit_developer_output tool and returns DeveloperOutput", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu1", name: "emit_developer_output", input: { diff: "@@ -1 +1 @@\n-foo\n+bar\n", summary: "Renamed foo to bar", testsAdded: ["test/foo.test.ts"], filesModified: ["src/foo.ts"] } }],
      model: DEVELOPER_ANTHROPIC_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 50 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const result = await anthropicPass({
      llm,
      skills,
      userTurn: "rename foo to bar",
      architectArtifact: { plan: "rename foo" },
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
    });

    expect(result.diff).toContain("@@");
    expect(result.summary).toBe("Renamed foo to bar");
    expect(result.filesModified).toEqual(["src/foo.ts"]);

    const body = sdkCreate.mock.calls[0][0] as { tool_choice?: { type: string; name: string }; tools?: Array<{ name: string }> };
    expect(body.tool_choice).toEqual({ type: "tool", name: "emit_developer_output" });
    expect(body.tools?.[0].name).toBe("emit_developer_output");
  });

  it("includes assembled skill prompt in system messages", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu2", name: "emit_developer_output", input: { diff: "@@ x", summary: "x", testsAdded: [], filesModified: ["a.ts"] } }],
      model: DEVELOPER_ANTHROPIC_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    await anthropicPass({ llm, skills, userTurn: "do x", architectArtifact: null, graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } });

    const body = sdkCreate.mock.calls[0][0] as { system?: Array<{ text: string }> };
    const systemText = body.system?.map((s) => s.text).join("\n") ?? "";
    expect(systemText).toContain("tdd-feature");
    expect(systemText).toContain("edit-only-what-changed");
  });
});
