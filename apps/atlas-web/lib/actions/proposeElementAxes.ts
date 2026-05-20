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
  const raw = json.choices[0]!.message.content;
  // Some LLMs honor `response_format: json_object` strictly, others wrap the
  // payload in a ```json ... ``` markdown fence. Strip the fence if present
  // so JSON.parse doesn't choke on the backticks.
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Last-ditch: find the first `[` or `{` and the last `]` or `}` and try that slice.
    const start = stripped.search(/[\[{]/);
    const lastBracket = stripped.lastIndexOf("]");
    const lastBrace = stripped.lastIndexOf("}");
    const end = Math.max(lastBracket, lastBrace);
    if (start >= 0 && end > start) {
      parsed = JSON.parse(stripped.slice(start, end + 1));
    } else {
      throw new Error(`proposeElementAxes: could not parse LLM response: ${raw.slice(0, 200)}`);
    }
  }
  if (Array.isArray(parsed)) return parsed as ElementAxis[];
  const maybeWrapped = parsed as { axes?: ElementAxis[] };
  return maybeWrapped.axes ?? [];
}
