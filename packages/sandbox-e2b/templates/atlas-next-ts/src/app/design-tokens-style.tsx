/**
 * Renders a <style> tag in <head> exposing the design-tokens.json palette,
 * typography, radius, and spacing as CSS custom properties on :root. Imported
 * once from layout.tsx. Picked over a webpack PostCSS injection because:
 *
 *  1. Next's webpack invalidates this module's chunk whenever design-tokens.json
 *     changes (resolveJsonModule import), so HMR re-runs the layout and the
 *     new <style> swaps in without a full reload.
 *  2. Stays a pure server component — no client-bundle weight, no FOUC.
 *  3. Single source of truth lives in JSON; no duplicate values in globals.css.
 *
 * Tailwind utilities pick up the same JSON via tailwind.config.ts. CSS vars
 * here are for arbitrary inline styles (e.g. `style={{ color: 'var(--color-primary)' }}`)
 * that the developer LLM occasionally emits when no fitting utility exists.
 */
import tokens from "../design-tokens.json";

const DEFAULTS = {
  palette: {
    primary: "#2563eb",
    secondary: "#64748b",
    accent: "#0ea5e9",
    muted: "#f1f5f9",
    background: "#ffffff",
    foreground: "#0f172a"
  },
  typography: {
    headingFont: "Inter",
    bodyFont: "Inter",
    headingScale: "1.25"
  },
  radius: { base: "0.5rem" },
  spacing: { section: "5rem" }
};

interface DesignTokensShape {
  palette?: Partial<typeof DEFAULTS.palette>;
  typography?: Partial<typeof DEFAULTS.typography>;
  radius?: Partial<typeof DEFAULTS.radius>;
  spacing?: Partial<typeof DEFAULTS.spacing>;
}

export function DesignTokensStyle(): JSX.Element {
  const t = tokens as DesignTokensShape;
  const palette = { ...DEFAULTS.palette, ...(t.palette ?? {}) };
  const typography = { ...DEFAULTS.typography, ...(t.typography ?? {}) };
  const radius = { ...DEFAULTS.radius, ...(t.radius ?? {}) };
  const spacing = { ...DEFAULTS.spacing, ...(t.spacing ?? {}) };

  const css = `:root {
  --color-primary: ${palette.primary};
  --color-secondary: ${palette.secondary};
  --color-accent: ${palette.accent};
  --color-muted: ${palette.muted};
  --color-background: ${palette.background};
  --color-foreground: ${palette.foreground};
  --font-heading: ${typography.headingFont};
  --font-body: ${typography.bodyFont};
  --type-heading-scale: ${typography.headingScale};
  --radius-base: ${radius.base};
  --spacing-section: ${spacing.section};
}`;

  return <style data-atlas-design-tokens dangerouslySetInnerHTML={{ __html: css }} />;
}
