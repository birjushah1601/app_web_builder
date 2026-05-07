import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { CanvasManifestSchema } from "@atlas/canvas-runtime";
import { ArchitectRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("ArchitectRole canvas event emission", () => {
  it("emits architect.canvas_manifest.emitted when artifact carries canvasManifest", async () => {
    const sdkCreate = vi
      .fn()
      // Pass 1 — triage
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "emit_ambiguity_report",
            input: { passed: true, scope: "new-app", questions: [] }
          }
        ],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 10 }
      })
      // Pass 2 — deep plan (model omits canvasManifest; enrichArchitectOutput synthesizes)
      .mockResolvedValueOnce({
        content: [
          {
            type: "tool_use",
            id: "t2",
            name: "emit_architect_output",
            input: {
              scope: "new-app",
              specGraph: { kind: "frontend-app" },
              runnablePlan: { tasks: [] }
            }
          }
        ],
        model: "claude-opus-4-7",
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 200 }
      });
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const role = new ArchitectRole({ llm: provider, skills });
    const result = await role.run({
      ritualId: "r-1",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "build a restaurant page"
    });

    const ev = result.events.find((e) => e.eventType === "architect.canvas_manifest.emitted");
    expect(ev).toBeDefined();
    const parse = CanvasManifestSchema.safeParse((ev!.payload as { manifest: unknown }).manifest);
    expect(parse.success).toBe(true);
  });
});
