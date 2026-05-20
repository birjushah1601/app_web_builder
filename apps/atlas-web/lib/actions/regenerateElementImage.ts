"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { cacheImage } from "@/lib/assets/image-cache";

/** Input shape:
 *  - instruction: free-form text prompt (e.g. "a sunset over a beach")
 *  - subjectHint: optional contextual hint (e.g. user's overall site purpose).
 *    Optional — keeps the action signature simple; the popover passes
 *    whatever's most useful.
 */
export interface RegenerateElementImageInput {
  instruction: string;
  subjectHint?: string;
}

export interface RegenerateElementImageOutput {
  ok: boolean;
  url?: string;
  error?: string;
}

/** Server Action: generate a single image via gpt-image-1, cache it, return
 *  the served URL. Used by ImageReplacePopover's "Regenerate with AI" button.
 *  No section images, no full ritual — just one ~$0.04 call. */
export async function regenerateElementImage(
  input: RegenerateElementImageInput
): Promise<RegenerateElementImageOutput> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthorized" };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY not configured" };

  const prompt = [
    `Cinematic, editorial-quality photograph.`,
    input.subjectHint ? `Subject context: ${input.subjectHint}.` : "",
    `Specific direction: ${input.instruction}.`,
    `THE IMAGE IS A PHOTOGRAPH ONLY. NO text, letters, words, captions, signs, logos, UI elements, buttons, menus, watermarks, or website chrome.`,
    `Composition: 16:9, vibrant but not oversaturated, professional commercial photography.`,
    `Reminder: pure photograph, no text.`
  ].filter(Boolean).join(" ");

  try {
    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1536x1024", n: 1 })
    });
    if (!resp.ok) {
      return { ok: false, error: `gpt-image-1 HTTP ${resp.status}: ${await resp.text()}` };
    }
    const json = (await resp.json()) as { data: Array<{ b64_json: string }> };
    const first = json.data[0];
    if (!first) return { ok: false, error: "gpt-image-1 returned empty data" };
    const buf = Buffer.from(first.b64_json, "base64");
    const url = await cacheImage(buf);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
