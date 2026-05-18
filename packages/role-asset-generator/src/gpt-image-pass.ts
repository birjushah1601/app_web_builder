import type { AssetGenInput, AssetManifest } from "./types.js";

export type CachedImageWriter = (buf: Buffer) => Promise<string>;

export interface GptImagePassDeps {
  apiKey: string;
  /** Injection seam — atlas-web wires this to its image-cache util. */
  writeImage: CachedImageWriter;
  fetchImpl?: typeof fetch;
}

/**
 * Plan SPU — gpt-image-1 hero PLUS 3 section images, generated in
 * parallel. The developer prompt surfaces section images by slot name,
 * so even without semantic understanding the developer can wire
 * `detail`, `environment`, and `process` slots into property cards, chef
 * photos, gallery tiles, etc. — anywhere it would otherwise have
 * fabricated a broken URL.
 *
 * Cost: ~$0.04 per gpt-image-1 call × 4 = ~$0.16/ritual. Parallel so the
 * wall-time impact is one call, not four. Failures collapse gracefully —
 * if a section image throws, that slot is dropped and the rest land.
 */
export async function gptImagePass(input: AssetGenInput, deps: GptImagePassDeps): Promise<AssetManifest> {
  const f = deps.fetchImpl ?? fetch;
  // Section-image count is env-gated to keep iteration cost low. Default 0
  // (hero only) so each ritual costs ~$0.04. Operators who want richer pages
  // can set ATLAS_HERO_SECTION_IMAGES_COUNT=3 to get detail/environment/process
  // slots filled in (~$0.16/ritual). Clamped to [0, 3] — adding more slots
  // requires also extending buildSlotPrompts.
  const requested = Number.parseInt(process.env.ATLAS_HERO_SECTION_IMAGES_COUNT ?? "0", 10);
  const sectionCount = Number.isFinite(requested) ? Math.max(0, Math.min(3, requested)) : 0;
  const slots = buildSlotPrompts(input).slice(0, 1 + sectionCount);

  // Parallel generation. Each slot's failure is per-slot — we Promise.allSettled
  // so a single section flake doesn't blow up the whole manifest. Hero is the
  // only required slot; if it fails, throw so the role falls back to Unsplash
  // / gradient.
  const results = await Promise.allSettled(
    slots.map(async (s) => {
      const buf = await callGptImage(f, deps.apiKey, s.prompt);
      const url = await deps.writeImage(buf);
      return { slot: s.slot, url, prompt: s.prompt, alt: s.alt };
    })
  );

  const heroResult = results[0]!;
  if (heroResult.status === "rejected") {
    throw heroResult.reason instanceof Error ? heroResult.reason : new Error(String(heroResult.reason));
  }
  const hero = heroResult.value;

  const sections: AssetManifest["sections"] = [];
  for (let i = 1; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === "fulfilled") sections.push(r.value);
    // Rejected section images are silently dropped; the developer just sees
    // one fewer slot in render-user-turn's "Asset manifest" block and falls
    // back to a CSS gradient or no image for that section.
  }

  return { hero, sections };
}

interface SlotPromptSpec {
  slot: string;
  prompt: string;
  alt: string;
}

function buildSlotPrompts(input: AssetGenInput): ReadonlyArray<SlotPromptSpec> {
  const heroPrompt = buildHeroPrompt(input);
  const baseAlt = deriveAlt(input);
  return [
    { slot: "hero", prompt: heroPrompt, alt: baseAlt },
    {
      slot: "detail",
      prompt: buildSectionPrompt(input, "an extreme close-up detail shot showing texture, craftsmanship, or a single hero element — macro photography, shallow depth of field"),
      alt: `Detail photo for ${baseAlt}`
    },
    {
      slot: "environment",
      prompt: buildSectionPrompt(input, "a wide environmental establishing shot showing the larger setting, space, or scene — natural light, sense of atmosphere"),
      alt: `Environment photo for ${baseAlt}`
    },
    {
      slot: "process",
      prompt: buildSectionPrompt(input, "a moment of action, process, or human presence inside the subject — candid documentary photography, motion, story"),
      alt: `Process photo for ${baseAlt}`
    }
  ];
}

function buildSectionPrompt(input: AssetGenInput, compositionDirective: string): string {
  const proposal = input.proposal as { recommended?: { tokens?: { palette?: unknown } } } | undefined;
  const brief = input.brief as { category?: string } | undefined;
  const subject = (typeof input.userTurn === "string" && input.userTurn.length > 0)
    ? input.userTurn
    : (brief?.category ?? "a modern landing page");
  const palette = JSON.stringify(proposal?.recommended?.tokens?.palette ?? {});
  return [
    `Cinematic, editorial-quality photograph for a website about: "${subject}".`,
    `THE IMAGE IS A PHOTOGRAPH ONLY. NO text, letters, words, signs, logos, UI elements, buttons, menus, watermarks, or website chrome.`,
    `Composition directive: ${compositionDirective}.`,
    `Subject matter: the real physical thing the user is building about — for a restaurant site that's food / kitchen / dining; for a luxury real estate site that's architecture / interiors / city views; for a SaaS data product that's abstract geometric data flow; etc.`,
    `Color tone inspired by: ${palette}.`,
    `Photography style: 3:2 aspect, natural lighting, vibrant but not oversaturated, professional commercial photography.`,
    `Reminder: pure photograph, no text.`
  ].join(" ");
}

function buildHeroPrompt(input: AssetGenInput): string {
  const proposal = input.proposal as { recommended?: { shortDescription?: string; tokens?: { palette?: unknown } } } | undefined;
  const brief = input.brief as { category?: string } | undefined;
  const subject = (typeof input.userTurn === "string" && input.userTurn.length > 0)
    ? input.userTurn
    : (brief?.category ?? "a modern landing page");
  const palette = JSON.stringify(proposal?.recommended?.tokens?.palette ?? {});
  // gpt-image-1 will happily render screenshots of pretend websites complete
  // with hallucinated nav bars, "Welcome to" headlines, and buttons baked
  // into the JPEG if you let it. Hammer the "no text, no UI" constraint
  // hard at both the start and end of the prompt — and frame the request as
  // a real-world photograph rather than a website hero, so the model doesn't
  // mentally reach for a "website hero image" reference (which is almost
  // always a screenshot-with-text composition in its training data).
  return [
    `Cinematic, editorial-quality photograph for use as the background of a website about: "${subject}".`,
    `THE IMAGE IS A PHOTOGRAPH ONLY. It MUST NOT contain any of the following: text, letters, words, captions, signs, logos, UI elements, buttons, menus, navigation bars, headlines, banners, watermarks, or any rendered website chrome of any kind. No "Welcome to" overlays. No "Reserve a table" buttons. No mock website screenshots. Pure photography of the real-world subject matter only.`,
    `Subject matter to photograph: depict the actual physical thing the user is building about — for a restaurant site, plated food on a styled table; for a luxury real estate site, an architectural exterior or interior; for a fitness app, athletes in motion; for a SaaS data product, abstract geometric data flow; etc. Choose the most evocative real-world scene that matches the user's prompt above.`,
    `Color tone inspired by this palette: ${palette}.`,
    `Composition: 16:9, generous negative space on one side for headline text to be overlaid later by CSS (do NOT bake the headline into the image), shallow depth of field, natural lighting, vibrant but not oversaturated, professional commercial photography style.`,
    `Reminder: NO text or UI in the image. It is a photograph.`
  ].join(" ");
}

function deriveAlt(input: AssetGenInput): string {
  if (typeof input.userTurn === "string" && input.userTurn.length > 0) {
    // Sanitize for JSX-attribute safety. The Developer LLM copies this
    // alt verbatim into <img alt="…" />, so any newline or unescaped
    // quote produces an unterminated-string-constant build error in the
    // sandbox. Replace smart-quotes + straight-quotes with apostrophes,
    // collapse whitespace (including \r\n), and truncate to keep the
    // alt accessible-readable.
    const sanitized = input.userTurn
      .replace(/[“”"]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    return sanitized.length > 120 ? `${sanitized.slice(0, 117)}…` : sanitized;
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
