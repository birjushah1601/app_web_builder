import { describe, it, expect } from "vitest";
import { AssetGeneratorRole } from "../src/role.js";

describe("AssetGeneratorRole", () => {
  it("has id 'asset-generator'", () => {
    const role = new AssetGeneratorRole();
    expect(role.id).toBe("asset-generator");
  });

  it("falls back to gradient when no flags set", async () => {
    delete process.env.ATLAS_FF_HERO_AI_IMAGE;
    delete process.env.ATLAS_FF_HERO_UNSPLASH;
    const role = new AssetGeneratorRole();
    const out = await role.run({
      ritualId: "r1",
      intent: "asset-generator",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "x",
      priorArtifact: { proposal: {}, brief: {}, projectId: "p1" }
    });
    const completed = out.events.find((e) => e.eventType === "asset.gen.completed");
    expect(completed).toBeDefined();
    const artifact = (out as unknown as { artifact?: { assetManifest?: { hero?: { url?: string } } } }).artifact;
    expect(artifact?.assetManifest?.hero?.url).toBe("");
  });

  it("emits asset.gen.started before asset.gen.completed", async () => {
    delete process.env.ATLAS_FF_HERO_AI_IMAGE;
    delete process.env.ATLAS_FF_HERO_UNSPLASH;
    const role = new AssetGeneratorRole();
    const out = await role.run({
      ritualId: "r1",
      intent: "asset-generator",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "x",
      priorArtifact: { proposal: {}, brief: {}, projectId: "p1" }
    });
    const types = out.events.map((e) => e.eventType);
    expect(types).toEqual(["asset.gen.started", "asset.gen.completed"]);
  });

  it("calls gpt-image-1 when ATLAS_FF_HERO_AI_IMAGE=true (mocked fetch)", async () => {
    process.env.ATLAS_FF_HERO_AI_IMAGE = "true";
    delete process.env.ATLAS_FF_HERO_UNSPLASH;
    const fetchCalls: Array<{ url: string }> = [];
    const fetchMock: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url });
      return new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from("img").toString("base64") }] }),
        { status: 200 }
      );
    };
    const writes: Buffer[] = [];
    const role = new AssetGeneratorRole({
      openaiKey: "sk-test",
      writeImage: async (buf) => {
        writes.push(buf);
        return "/atlas-assets/cached.jpg";
      },
      fetchImpl: fetchMock
    });
    const out = await role.run({
      ritualId: "r1",
      intent: "asset-generator",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "x",
      priorArtifact: {
        proposal: { recommended: { shortDescription: "warm + earthy", tokens: { palette: { primary: "#fff" } } } },
        brief: { category: "frontend-app" },
        projectId: "p1"
      }
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://api.openai.com/v1/images/generations");
    expect(writes).toHaveLength(1);
    const artifact = (out as unknown as { artifact?: { assetManifest?: { hero?: { url?: string; prompt?: string } } } }).artifact;
    expect(artifact?.assetManifest?.hero?.url).toBe("/atlas-assets/cached.jpg");
    // Prompt template no longer mentions artifactKind by name — it's a
    // cinematic-photograph template that describes the subject matter via
    // the user's prompt text directly. Verify the hallmark phrasing instead.
    expect(artifact?.assetManifest?.hero?.prompt).toMatch(/Cinematic.*photograph/i);
    delete process.env.ATLAS_FF_HERO_AI_IMAGE;
  });

  it("calls unsplash when only unsplash flag set (mocked fetch)", async () => {
    delete process.env.ATLAS_FF_HERO_AI_IMAGE;
    process.env.ATLAS_FF_HERO_UNSPLASH = "true";
    const fetchCalls: Array<{ url: string }> = [];
    const fetchMock: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url });
      return new Response(
        JSON.stringify({
          results: [{ urls: { regular: "https://images.unsplash.com/photo-xyz.jpg" }, alt_description: "warm restaurant" }]
        }),
        { status: 200 }
      );
    };
    const role = new AssetGeneratorRole({
      unsplashKey: "u-key",
      writeImage: async () => "",
      fetchImpl: fetchMock
    });
    const out = await role.run({
      ritualId: "r1",
      intent: "asset-generator",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "x",
      priorArtifact: { proposal: {}, brief: { category: "frontend-app", audienceCues: ["modern"] }, projectId: "p1" }
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toContain("api.unsplash.com");
    expect(fetchCalls[0]?.url).toContain("frontend-app");
    const artifact = (out as unknown as { artifact?: { assetManifest?: { hero?: { url?: string; alt?: string } } } }).artifact;
    expect(artifact?.assetManifest?.hero?.url).toMatch(/unsplash/);
    expect(artifact?.assetManifest?.hero?.alt).toBe("warm restaurant");
    delete process.env.ATLAS_FF_HERO_UNSPLASH;
  });

  it("falls back to gradient when unsplash returns no results", async () => {
    delete process.env.ATLAS_FF_HERO_AI_IMAGE;
    process.env.ATLAS_FF_HERO_UNSPLASH = "true";
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 });
    const role = new AssetGeneratorRole({
      unsplashKey: "u-key",
      writeImage: async () => "",
      fetchImpl: fetchMock
    });
    const out = await role.run({
      ritualId: "r1",
      intent: "asset-generator",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "x",
      priorArtifact: { proposal: {}, brief: { category: "frontend-app" }, projectId: "p1" }
    });
    expect(out.events.find((e) => e.eventType === "asset.gen.failed")).toBeDefined();
    const artifact = (out as unknown as { artifact?: { assetManifest?: { hero?: { url?: string } } } }).artifact;
    expect(artifact?.assetManifest?.hero?.url).toBe("");
    delete process.env.ATLAS_FF_HERO_UNSPLASH;
  });

  it("falls back to gradient when gpt-image fetch fails", async () => {
    process.env.ATLAS_FF_HERO_AI_IMAGE = "true";
    delete process.env.ATLAS_FF_HERO_UNSPLASH;
    const fetchMock: typeof fetch = async () => new Response("server boom", { status: 500 });
    const role = new AssetGeneratorRole({
      openaiKey: "sk-test",
      writeImage: async () => "/atlas-assets/whatever.jpg",
      fetchImpl: fetchMock
    });
    const out = await role.run({
      ritualId: "r1",
      intent: "asset-generator",
      graphSlice: { bytes: "{}", hash: "h" },
      userTurn: "x",
      priorArtifact: { proposal: {}, brief: { category: "frontend-app" }, projectId: "p1" }
    });
    const failed = out.events.find((e) => e.eventType === "asset.gen.failed");
    expect(failed).toBeDefined();
    const artifact = (out as unknown as { artifact?: { assetManifest?: { hero?: { url?: string } } } }).artifact;
    expect(artifact?.assetManifest?.hero?.url).toBe("");
    delete process.env.ATLAS_FF_HERO_AI_IMAGE;
  });
});
