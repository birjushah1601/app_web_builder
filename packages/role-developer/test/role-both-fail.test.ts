import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { AnthropicProvider, GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { DeveloperRole } from "../src/role.js";
import { BothProvidersFailedError } from "../src/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("DeveloperRole.run (both providers fail)", () => {
  it("throws BothProvidersFailedError and emits developer.both_failed; no reviewer call", async () => {
    const anthropicCreate = vi.fn().mockRejectedValue(new Error("Anthropic down"));
    const anthropicSdk = { messages: { create: anthropicCreate, stream: vi.fn() } } as never;
    const anthropic = new AnthropicProvider({ sdk: anthropicSdk, metrics: createProviderMetrics(new Registry()) });

    const googleGenerate = vi.fn().mockRejectedValue(new Error("Google down"));
    const googleSdk = { getGenerativeModel: () => ({ generateContent: googleGenerate }) } as never;
    const google = new GoogleProvider({ sdk: googleSdk, metrics: createProviderMetrics(new Registry()) });

    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);
    const role = new DeveloperRole({ anthropic, google, reviewer: anthropic, skills });

    let thrown: unknown;
    try {
      await role.run({
        ritualId: "r-both-fail",
        intent: "developer",
        graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
        userTurn: "do something"
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(BothProvidersFailedError);
  });
});
