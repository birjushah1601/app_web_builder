import type { AssetGenInput, AssetManifest } from "./types.js";

export type CachedImageWriter = (buf: Buffer) => Promise<string>;

export interface GptImagePassDeps {
  apiKey: string;
  /** Injection seam — atlas-web wires this to its image-cache util. */
  writeImage: CachedImageWriter;
  fetchImpl?: typeof fetch;
}

/**
 * Plan SPU — single gpt-image-1 hero pass. Builds a category-aware
 * prompt from the design proposal + researcher brief, calls the
 * OpenAI Images endpoint (b64 response), and hands the bytes to the
 * caller-supplied `writeImage` to land in a cache. Returns a manifest
 * with just the hero filled in; section images are out of scope for
 * this slice.
 */
export async function gptImagePass(input: AssetGenInput, deps: GptImagePassDeps): Promise<AssetManifest> {
  const f = deps.fetchImpl ?? fetch;
  const heroPrompt = buildHeroPrompt(input);
  const buf = await callGptImage(f, deps.apiKey, heroPrompt);
  const url = await deps.writeImage(buf);
  return {
    hero: { slot: "hero", url, prompt: heroPrompt, alt: deriveAlt(input) },
    sections: []
  };
}

function buildHeroPrompt(input: AssetGenInput): string {
  const proposal = input.proposal as { recommended?: { shortDescription?: string; tokens?: { palette?: unknown } } } | undefined;
  const brief = input.brief as { category?: string } | undefined;
  const category = brief?.category ?? "landing page";
  const style = proposal?.recommended?.shortDescription ?? "modern, accessible";
  const palette = JSON.stringify(proposal?.recommended?.tokens?.palette ?? {});
  return `Photorealistic hero image for: ${category}. Style: ${style}. Palette inspiration: ${palette}. Composition: centered, generous negative space, no text overlay. 16:9, vibrant.`;
}

function deriveAlt(input: AssetGenInput): string {
  const brief = input.brief as { category?: string } | undefined;
  return `Hero image for ${brief?.category ?? "landing page"}`;
}

async function callGptImage(f: typeof fetch, apiKey: string, prompt: string): Promise<Buffer> {
  const resp = await f("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", n: 1, response_format: "b64_json" })
  });
  if (!resp.ok) throw new Error(`gpt-image-1 HTTP ${resp.status}: ${await resp.text()}`);
  const json = (await resp.json()) as { data: Array<{ b64_json: string }> };
  const first = json.data[0];
  if (!first) throw new Error("gpt-image-1: empty data array");
  return Buffer.from(first.b64_json, "base64");
}
