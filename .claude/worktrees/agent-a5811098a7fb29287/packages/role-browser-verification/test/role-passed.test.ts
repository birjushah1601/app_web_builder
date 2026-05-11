import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { BrowserVerificationRole } from "../src/role.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("BrowserVerificationRole.run (passed)", () => {
  it("returns role output with browser-verification.passed event when no critical issues", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu",
          name: "emit_browser_verification_report",
          input: {
            passed: true,
            issues: [],
            skillsRun: [
              "page-load-check",
              "viewport-render-check",
              "console-error-check",
              "network-requests-audit"
            ]
          }
        }
      ],
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new BrowserVerificationRole({ llm, skills });

    const out = await role.run({
      ritualId: "r-bv-1",
      intent: "browser-verification",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: "check this diff"
    });

    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("browser-verification.started");
    expect(types).toContain("browser-verification.passed");
    expect(types).toContain("browser-verification.completed");
    expect(out.diff.kind).toBe("none");

    const completed = out.events.find((e) => e.eventType === "browser-verification.completed");
    expect((completed?.payload as { passed: boolean }).passed).toBe(true);
  });
});
