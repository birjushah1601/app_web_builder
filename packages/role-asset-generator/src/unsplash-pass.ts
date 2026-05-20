import type { AssetGenInput, AssetManifest } from "./types.js";

export interface UnsplashPassDeps {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/**
 * Plan SPU — Unsplash search fallback for hero imagery. Cheaper than
 * gpt-image-1 but the URLs are external (CDN), so no caching is needed
 * — Unsplash serves them with their own cache headers. Used when
 * ATLAS_FF_HERO_UNSPLASH=true and ATLAS_FF_HERO_AI_IMAGE is off (or
 * its key is missing).
 */
export async function unsplashPass(input: AssetGenInput, deps: UnsplashPassDeps): Promise<AssetManifest> {
  const f = deps.fetchImpl ?? fetch;
  const query = buildQuery(input);
  const resp = await f(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
    { headers: { Authorization: `Client-ID ${deps.apiKey}` } }
  );
  if (!resp.ok) throw new Error(`unsplash HTTP ${resp.status}`);
  const json = (await resp.json()) as { results: Array<{ urls: { regular: string }; alt_description?: string }> };
  const first = json.results[0];
  if (!first) throw new Error(`unsplash: no results for "${query}"`);
  return {
    hero: {
      slot: "hero",
      url: first.urls.regular,
      alt: first.alt_description ?? `Hero for ${query}`
    },
    sections: []
  };
}

function buildQuery(input: AssetGenInput): string {
  const brief = input.brief as { category?: string; audienceCues?: ReadonlyArray<string> } | undefined;
  const cues = brief?.audienceCues ?? [];
  return `${brief?.category ?? "landing"} ${cues.join(" ")}`.trim();
}
