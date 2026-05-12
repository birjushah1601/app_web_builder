"use server";
/**
 * Plan UXO Task 8 — per-element Haiku-proposed slider axes.
 *
 * Given a selected DOM node (tag + classes + text), asks Claude Haiku 4.5
 * via the project's OpenAI-compatible LLM proxy to propose 2-5 adjustable
 * axes a designer would actually want for this element. The returned axes
 * become <input type="range"> sliders inside <ElementInspector />.
 *
 * Env contract (same shape as packages/llm-openai-compat):
 *   - ATLAS_LLM_BASE_URL → "https://…/v1" of an OpenAI-compatible proxy
 *   - ATLAS_LLM_API_KEY  → bearer token for that proxy
 *
 * V1 limitations (deliberate, tracked in spec):
 *   - `cssProperty` axes are runtime-only (applied via the edit-bridge);
 *     `applyElementAxisChange` persists only `tokenKey` axes to source.
 *   - The Haiku response is trusted blindly: we just JSON-parse and
 *     filter to an array. A malformed payload throws and the inspector
 *     shows zero sliders rather than crash the canvas.
 *
 * Gated by `ATLAS_FF_ELEMENT_SLIDERS` at the call site (the inspector is
 * only mounted when the flag is on AND mode === "visual-edits").
 */

export interface ElementContext {
  tag: string;
  classes: string[];
  text: string;
  computedStyle?: Record<string, string>;
}

export interface ElementAxis {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  currentValue: number;
  cssProperty?: string;
  tokenKey?: string;
}

export async function proposeElementAxes(ctx: ElementContext): Promise<ElementAxis[]> {
  const url = process.env.ATLAS_LLM_BASE_URL;
  const key = process.env.ATLAS_LLM_API_KEY;
  if (!url || !key) throw new Error("LLM not configured");
  const sys = `Given an HTML element + classes, propose 2-5 adjustable axes a designer would actually want.
Return a JSON array. Schema:
{ name, label, min, max, step, unit, currentValue, cssProperty?, tokenKey? }
Examples: button → primary color (tokenKey: palette.primary), border-radius (cssProperty: borderRadius). text → font-size (cssProperty: fontSize), letter-spacing. image → object-fit (cssProperty: objectFit).`;
  const resp = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4.5",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify(ctx) }
      ],
      response_format: { type: "json_object" }
    })
  });
  const json = (await resp.json()) as { choices: Array<{ message: { content: string } }> };
  const parsed = JSON.parse(json.choices[0]!.message.content) as unknown;
  if (Array.isArray(parsed)) return parsed as ElementAxis[];
  const maybeWrapped = parsed as { axes?: ElementAxis[] };
  return maybeWrapped.axes ?? [];
}
