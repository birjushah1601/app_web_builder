import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { ArchitectRole } from "../src/role.js";
import type { PriorRitualContext } from "@atlas/ritual-engine";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

/**
 * Plan L follow-up: when the engine's auto-fix loop chains the architect
 * after a gate failure, the architect must NOT run its triage LLM call
 * (which routinely returns blocker questions like "what compliance
 * level?" or "do you support RTL?" — questions a child ritual has no UI
 * to answer). Instead it should synthesize a bug-fix artifact directly
 * from the parent's failing gate report and let the developer remediate.
 *
 * These tests pin: (1) NO LLM call when fix-mode triggers, (2) the
 * synthesized artifact is shaped as a BugFixOutput derived from the
 * issue list, (3) the bypass does NOT trigger when there's no failing
 * gate report (fresh request OR refinement of a passed ritual).
 */
describe("ArchitectRole fix-mode bypass (PriorRitualContext + failing gate)", () => {
  const noopSdk = { messages: { create: vi.fn(), stream: vi.fn() } } as never;
  const provider = new AnthropicProvider({ sdk: noopSdk, metrics: createProviderMetrics(new Registry()) });
  const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

  const failingGatePrior: PriorRitualContext = {
    kind: "priorRitual",
    parentRitualId: "r-parent-1",
    parentAccessibilityReport: {
      passed: false,
      issues: [
        { severity: "critical", code: "WCAG-1.4.3", message: "Insufficient contrast in hero", file: "src/app/page.tsx", line: 12 },
        { severity: "high", code: "WCAG-2.1.1", message: "Missing focus indicator", file: "src/app/page.tsx", line: 45 }
      ],
      skillsRun: ["wcag-audit", "contrast-check"]
    }
  };

  it("emits 4 synthetic events without making any LLM call", async () => {
    const sdkSpy = vi.fn();
    const spyProvider = new AnthropicProvider({
      sdk: { messages: { create: sdkSpy, stream: vi.fn() } } as never,
      metrics: createProviderMetrics(new Registry())
    });
    const role = new ArchitectRole({ llm: spyProvider, skills });

    const out = await role.run({
      ritualId: "r-child-1",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "build a restaurant site",
      priorArtifact: failingGatePrior
    });

    expect(sdkSpy).not.toHaveBeenCalled();

    const types = out.events.map((e) => e.eventType);
    expect(types).toEqual([
      "architect.pass1.started",
      "architect.pass1.completed",
      "architect.pass2.started",
      "architect.pass2.completed"
    ]);
    for (const e of out.events) {
      expect((e.payload as { fixMode?: boolean }).fixMode).toBe(true);
    }
  });

  it("synthesizes a bug-fix artifact whose rootCause references the gate findings", async () => {
    const role = new ArchitectRole({ llm: provider, skills });
    const out = await role.run({
      ritualId: "r-child-2",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "build a restaurant site",
      priorArtifact: failingGatePrior
    });

    const completed = out.events.find((e) => e.eventType === "architect.pass2.completed")!;
    const artifact = completed.payload.artifact as {
      scope: string;
      bugReport: { phase1_reproduce: string; rootCause: string };
    };
    expect(artifact.scope).toBe("bug-fix");
    expect(artifact.bugReport.rootCause).toMatch(/2 gate findings/);
    // Each issue's code + file should appear in phase1_reproduce so the
    // developer pass has explicit fix targets.
    expect(artifact.bugReport.phase1_reproduce).toContain("WCAG-1.4.3");
    expect(artifact.bugReport.phase1_reproduce).toContain("WCAG-2.1.1");
    expect(artifact.bugReport.phase1_reproduce).toContain("src/app/page.tsx:12");
    expect(artifact.bugReport.phase1_reproduce).toContain("src/app/page.tsx:45");
  });

  it("does NOT bypass when the prior ritual's gates passed (refinement, not fix)", async () => {
    const sdkSpy = vi.fn().mockResolvedValueOnce({
      content: [{
        type: "tool_use", id: "t1", name: "emit_ambiguity_report",
        input: { passed: true, scope: "new-feature", questions: [] }
      }],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 5 }
    }).mockResolvedValueOnce({
      content: [{
        type: "tool_use", id: "t2", name: "emit_architect_output",
        input: {
          scope: "new-feature",
          diffPlan: { summary: "x", tasks: [] },
          graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) }
        }
      }],
      model: "claude-opus-4-7",
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 5 }
    });
    const spyProvider = new AnthropicProvider({
      sdk: { messages: { create: sdkSpy, stream: vi.fn() } } as never,
      metrics: createProviderMetrics(new Registry())
    });
    const role = new ArchitectRole({ llm: spyProvider, skills });

    const passingPrior: PriorRitualContext = {
      kind: "priorRitual",
      parentRitualId: "r-parent-3",
      parentAccessibilityReport: { passed: true, issues: [], skillsRun: [] }
    };

    const out = await role.run({
      ritualId: "r-child-3",
      intent: "architect",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "tweak the hero",
      priorArtifact: passingPrior
    });

    // LLM was called → normal path took over
    expect(sdkSpy).toHaveBeenCalled();
    const completed = out.events.find((e) => e.eventType === "architect.pass2.completed")!;
    const artifact = completed.payload.artifact as { scope: string };
    expect(artifact.scope).toBe("new-feature");
  });
});
