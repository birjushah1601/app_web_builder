import { describe, it, expect, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "prom-client";
import { GoogleProvider, createProviderMetrics } from "@atlas/llm-provider";
import { createRegistryWithOverrides, loadSkillsFromDir } from "@atlas/skill-runtime";
import { googlePass, DEVELOPER_GOOGLE_MODEL } from "../src/google-pass.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "skills");

describe("googlePass", () => {
  it("calls completeWithToolUse with emit_developer_output tool and returns DeveloperOutput", async () => {
    const generateContent = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "@@ -1 +1 @@\n-foo\n+bar\n", summary: "Renamed foo to bar", testsAdded: ["test/foo.test.ts"], filesModified: ["src/foo.ts"] } }]
      }
    }));
    const sdk = { getGenerativeModel: () => ({ generateContent }) } as never;
    const llm = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    const result = await googlePass({
      llm,
      skills,
      userTurn: "rename foo to bar",
      architectArtifact: { plan: "rename foo" },
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      model: DEVELOPER_GOOGLE_MODEL
    });

    expect(result.diff).toContain("@@");
    expect(result.summary).toBe("Renamed foo to bar");
    expect(result.filesModified).toEqual(["src/foo.ts"]);
  });

  it("includes assembled skill prompt in user messages (merged from system)", async () => {
    const generateContent = vi.fn(async () => ({
      response: {
        text: () => "",
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        functionCalls: () => [{ name: "emit_developer_output", args: { diff: "@@ x", summary: "x", testsAdded: [], filesModified: ["a.ts"] } }]
      }
    }));
    const sdk = { getGenerativeModel: () => ({ generateContent }) } as never;
    const llm = new GoogleProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    const skills = createRegistryWithOverrides(loadSkillsFromDir(fixtureDir), []);

    await googlePass({ llm, skills, userTurn: "do x", architectArtifact: null, graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) } });

    // Gemini merges system into user turn
    const call = generateContent.mock.calls[0][0] as { contents: Array<{ role: string; parts: Array<{ text: string }> }> };
    const merged = call.contents[0].parts[0].text;
    expect(merged).toContain("tdd-feature");
    expect(merged).toContain("edit-only-what-changed");
  });
});
