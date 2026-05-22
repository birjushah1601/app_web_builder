import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ResearcherRole } from "../src/role.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATALOG_DIR = path.resolve(__dirname, "..", "catalog");
// Real skills dir from the bundled @atlas/skill-library tree.
const SKILLS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "skill-library",
  "skills",
  "researcher"
);

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_brief", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const validBriefReply = (category: string) => ({
  category,
  audienceCues: [],
  references: [{ name: "X", why: "y", sourceTier: "local-catalog" }],
  patternsThatWin: ["a"],
  patternsThatLose: ["b"]
});

describe("ResearcherRole — per-artifactKind skill composition", () => {
  it("prepends assemble-brief-frontend-app when designIntent.artifactKind === 'frontend-app'", async () => {
    const llm = fakeLLM(validBriefReply("saas-marketing"));
    const role = new ResearcherRole({
      llm: llm as never,
      catalogDir: CATALOG_DIR,
      skillsDir: SKILLS_DIR
    });
    const out = await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: {
          category: "saas-marketing",
          audienceCues: [],
          artifactKind: "frontend-app"
        }
      }
    });

    const composed = out.events.find((e) => e.eventType === "researcher.skills.composed");
    expect(composed).toBeDefined();
    const skills = (composed?.payload as { skills: string[] } | undefined)?.skills ?? [];
    expect(skills).toEqual(["assemble-brief-frontend-app", "assemble-brief"]);
  });

  it("prepends assemble-brief-backend-rest-api when artifactKind === 'backend-rest-api'", async () => {
    const llm = fakeLLM(validBriefReply("saas-marketing"));
    const role = new ResearcherRole({
      llm: llm as never,
      catalogDir: CATALOG_DIR,
      skillsDir: SKILLS_DIR
    });
    const out = await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: {
          category: "stripe-style-api",
          audienceCues: [],
          artifactKind: "backend-rest-api"
        }
      }
    });

    const composed = out.events.find((e) => e.eventType === "researcher.skills.composed");
    expect(composed).toBeDefined();
    const skills = (composed?.payload as { skills: string[] } | undefined)?.skills ?? [];
    expect(skills).toEqual(["assemble-brief-backend-rest-api", "assemble-brief"]);
  });

  it("falls back to generic assemble-brief when artifactKind is missing", async () => {
    const llm = fakeLLM(validBriefReply("restaurant-landing"));
    const role = new ResearcherRole({
      llm: llm as never,
      catalogDir: CATALOG_DIR,
      skillsDir: SKILLS_DIR
    });
    const out = await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: { category: "restaurant-landing", audienceCues: [] }
      }
    });

    const composed = out.events.find((e) => e.eventType === "researcher.skills.composed");
    expect(composed).toBeDefined();
    const skills = (composed?.payload as { skills: string[] } | undefined)?.skills ?? [];
    expect(skills).toEqual(["assemble-brief"]);
  });

  it("falls back to generic assemble-brief when artifactKind has no per-kind skill on disk", async () => {
    const llm = fakeLLM(validBriefReply("unknown-kind-thing"));
    const role = new ResearcherRole({
      llm: llm as never,
      catalogDir: CATALOG_DIR,
      skillsDir: SKILLS_DIR
    });
    const out = await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: {
          category: "unknown-kind-thing",
          audienceCues: [],
          // Use a synthetic artifactKind with no per-kind assemble-brief-*.md
          // skill on disk. As of 2026-05-23, all 6 known kinds (frontend-app,
          // backend-rest-api, backend-graphql, data-pipeline, mobile-app,
          // cli-tool) DO have per-kind skills, so the fallback only fires for
          // truly novel kinds.
          artifactKind: "synthetic-test-only-no-skill-on-disk"
        }
      }
    });

    const composed = out.events.find((e) => e.eventType === "researcher.skills.composed");
    expect(composed).toBeDefined();
    const skills = (composed?.payload as { skills: string[] } | undefined)?.skills ?? [];
    expect(skills).toEqual(["assemble-brief"]);
  });

  it("composes per-kind + generic skills when artifactKind has a per-kind skill on disk", async () => {
    const llm = fakeLLM(validBriefReply("data-pipeline-thing"));
    const role = new ResearcherRole({
      llm: llm as never,
      catalogDir: CATALOG_DIR,
      skillsDir: SKILLS_DIR
    });
    const out = await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: {
          category: "data-pipeline-thing",
          audienceCues: [],
          artifactKind: "data-pipeline"
        }
      }
    });

    const composed = out.events.find((e) => e.eventType === "researcher.skills.composed");
    expect(composed).toBeDefined();
    const skills = (composed?.payload as { skills: string[] } | undefined)?.skills ?? [];
    // Per-kind skill is preferred (listed first); generic fallback retained
    // so the LLM has both contexts to work from.
    expect(skills).toEqual(["assemble-brief-data-pipeline", "assemble-brief"]);
  });
});
