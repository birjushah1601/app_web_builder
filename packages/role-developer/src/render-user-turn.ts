/**
 * Renders the Developer's user-turn message with prominent sections for
 * data the LLM frequently overlooks when buried inside a JSON dump:
 *
 * - `selectedTokens` (the Designer's chosen palette/typography/spacing) —
 *   surfaced first so the developer applies them to design-tokens.json
 *   AND uses the matching Tailwind classes throughout.
 * - `designIntent` and `canvasManifest` — kept as JSON since they're
 *   already structured but no longer leading.
 * - `runnablePlan` and `specGraph` — last, since they're often empty for
 *   greenfield prompts and the developer can fall back to user intent.
 *
 * Falls back gracefully when architectArtifact is null / missing fields.
 */

interface SelectedTokens {
  palette?: Record<string, unknown>;
  typeScale?: Record<string, unknown>;
  typography?: Record<string, unknown>;
  density?: string;
  componentSet?: string;
  imageryStrategy?: string;
  copyVoice?: string;
}

function extractSelectedTokens(artifact: unknown): SelectedTokens | undefined {
  if (!artifact || typeof artifact !== "object") return undefined;
  const tokens = (artifact as { selectedTokens?: SelectedTokens }).selectedTokens;
  if (!tokens || typeof tokens !== "object") return undefined;
  return tokens;
}

function renderTokensSection(tokens: SelectedTokens): string {
  const lines = ["## Chosen design tokens (apply these — don't reinvent)"];
  if (tokens.palette) {
    lines.push("", "Palette (rewrite `src/design-tokens.json` with these values):");
    for (const [k, v] of Object.entries(tokens.palette)) {
      lines.push(`  - ${k}: ${String(v)}`);
    }
  }
  const typo = tokens.typography ?? tokens.typeScale;
  if (typo) {
    lines.push("", "Typography:");
    for (const [k, v] of Object.entries(typo)) {
      lines.push(`  - ${k}: ${String(v)}`);
    }
  }
  if (tokens.density) lines.push("", `Density: ${tokens.density}`);
  if (tokens.componentSet) lines.push(`Component set: ${tokens.componentSet}`);
  if (tokens.imageryStrategy) lines.push(`Imagery: ${tokens.imageryStrategy}`);
  if (tokens.copyVoice) lines.push(`Copy voice: ${tokens.copyVoice}`);

  lines.push(
    "",
    "Use these tokens consistently across hero, sections, buttons, and footer. " +
    "Update `src/design-tokens.json` to reflect them so Tailwind's theme rebuilds. " +
    "Don't fall back to default purple/blue if the palette specifies something else.",
    ""
  );
  return lines.join("\n");
}

export function renderDeveloperUserTurn(userTurn: string, architectArtifact: unknown): string {
  const sections: string[] = [`User intent: ${userTurn}`];
  const tokens = extractSelectedTokens(architectArtifact);
  if (tokens) sections.push("", renderTokensSection(tokens));

  sections.push(
    "",
    "## Build target",
    "",
    "Produce a complete landing page (not a stub). Default scaffold for new-app / new-feature requests:",
    "- Hero section with headline, subheading, primary CTA",
    "- 2-4 supporting sections (features grid, about, gallery, testimonials, or pricing — pick what fits the intent)",
    "- Footer with at least site name + a couple links",
    "",
    "Match the chosen design tokens. Use semantic HTML (header / main / section / footer). Tailwind utilities only — no inline color overrides.",
    "",
    "## Architect artifact (full context)",
    "",
    "```json",
    JSON.stringify(architectArtifact, null, 2),
    "```"
  );
  return sections.join("\n");
}
