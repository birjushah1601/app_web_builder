import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { ResearcherRole } from "../src/role.js";
import type { WebFetchAdapter, WebHit } from "../src/web-fetch.js";
import { loadCatalog } from "../src/local-catalog.js";

const CATALOG_DIR = path.resolve(__dirname, "..", "catalog");

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

describe("ResearcherRole", () => {
  it("has id 'researcher'", () => {
    const role = new ResearcherRole({ llm: fakeLLM(validBriefReply("x")) as never, catalogDir: CATALOG_DIR });
    expect(role.id).toBe("researcher");
  });

  it("happy path: catalog hit + LLM reply → brief in events", async () => {
    const llm = fakeLLM(validBriefReply("restaurant-landing"));
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR });
    const out = await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "build a restaurant landing",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "restaurant-landing", audienceCues: [] } }
    });
    const completed = out.events.find((e) => e.eventType === "researcher.brief.completed");
    expect(completed).toBeDefined();
    expect((completed?.payload as { brief?: { category: string } } | undefined)?.brief?.category).toBe("restaurant-landing");
  });

  it("fast-mode: skips LLM, returns mechanically-built brief", async () => {
    const llm = fakeLLM(validBriefReply("restaurant-landing"));
    const role = new ResearcherRole({
      llm: llm as never,
      catalogDir: CATALOG_DIR,
      mode: "fast"
    });
    const out = await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "restaurant-landing", audienceCues: [] } }
    });
    expect((llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse).not.toHaveBeenCalled();
    const completed = out.events.find((e) => e.eventType === "researcher.brief.completed");
    expect(completed).toBeDefined();
  });

  it("empty-catalog: still emits a brief (web-only or LLM-only path)", async () => {
    const llm = fakeLLM(validBriefReply("battle-mech-configurator"));
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR });
    const out = await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "battle-mech-configurator", audienceCues: [] } }
    });
    const completed = out.events.find((e) => e.eventType === "researcher.brief.completed");
    expect(completed).toBeDefined();
  });

  it("with web adapter: passes web hits to assembleBrief", async () => {
    const llm = fakeLLM(validBriefReply("saas-marketing"));
    const adapter: WebFetchAdapter = {
      async search(_q: string): Promise<WebHit[]> {
        return [{ title: "Linear", url: "https://linear.app", description: "issues" }];
      }
    };
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR, webAdapter: adapter });
    await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "saas-marketing", audienceCues: [] } }
    });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ content: string }>;
    const userMsg = messages.find((m) => m.content?.includes("Linear"));
    expect(userMsg).toBeDefined();
  });

  it("web fetch error doesn't fail the role (falls back to local-only)", async () => {
    const llm = fakeLLM(validBriefReply("saas-marketing"));
    const adapter: WebFetchAdapter = {
      async search(_q: string): Promise<WebHit[]> {
        throw new Error("brave 503");
      }
    };
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR, webAdapter: adapter });
    const out = await role.run({
      ritualId: "r1",
      intent: "researcher",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "saas-marketing", audienceCues: [] } }
    });
    const completed = out.events.find((e) => e.eventType === "researcher.brief.completed");
    expect(completed).toBeDefined();
    const failed = out.events.find((e) => e.eventType === "researcher.brief.failed");
    expect(failed).toBeUndefined(); // role still succeeds
  });

  it("LLM error → researcher.brief.failed event + throws", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("LLM 503"))
    } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> };
    const role = new ResearcherRole({ llm: llm as never, catalogDir: CATALOG_DIR });
    await expect(
      role.run({
        ritualId: "r1",
        intent: "researcher",
        userTurn: "x",
        graphSlice: { bytes: "{}", hash: "h" },
        priorArtifact: { designIntent: { category: "restaurant-landing", audienceCues: [] } }
      })
    ).rejects.toThrow();
  });
});
