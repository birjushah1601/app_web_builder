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
  // User's actual ask is the subject. When absent, fall back to the
  // architect's artifactKind / Researcher's category so we never produce a
  // blank prompt — but the absent-userTurn path is the generic-mockup case
  // we're fixing.
  const subject = (typeof input.userTurn === "string" && input.userTurn.length > 0)
    ? input.userTurn
    : (brief?.category ?? "a modern landing page");
  const style = proposal?.recommended?.shortDescription ?? "modern, accessible";
  const palette = JSON.stringify(proposal?.recommended?.tokens?.palette ?? {});
  return `Photorealistic hero image for the following website: "${subject}". Use it as subject matter — the image should depict what the user is building (a luxury real estate property if that's the ask, a SaaS dashboard if that's the ask, etc.), NOT a generic UI mockup. Visual style: ${style}. Palette inspiration: ${palette}. Composition: centered, generous negative space, no text overlay. 16:9, vibrant, professional photography.`;
}

function deriveAlt(input: AssetGenInput): string {
  if (typeof input.userTurn === "string" && input.userTurn.length > 0) {
    // Truncate so the alt stays accessible-readable, not a sentence dump.
    return input.userTurn.length > 120 ? `${input.userTurn.slice(0, 117)}…` : input.userTurn;
  }
  const brief = input.brief as { category?: string } | undefined;
  return `Hero image for ${brief?.category ?? "landing page"}`;
}

async function callGptImage(f: typeof fetch, apiKey: string, prompt: string): Promise<Buffer> {
  const resp = await f("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    // gpt-image-1 always returns base64 — `response_format` is a DALL-E 3
    // parameter and gpt-image-1 rejects it with HTTP 400. Omit.
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", n: 1 })
  });
  if (!resp.ok) throw new Error(`gpt-image-1 HTTP ${resp.status}: ${await resp.text()}`);
  const json = (await resp.json()) as { data: Array<{ b64_json: string }> };
  const first = json.data[0];
  if (!first) throw new Error("gpt-image-1: empty data array");
  return Buffer.from(first.b64_json, "base64");
}
