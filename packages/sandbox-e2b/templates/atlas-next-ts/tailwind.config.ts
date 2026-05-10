import type { Config } from "tailwindcss";
import tokens from "./src/design-tokens.json";

// Fail-safe defaults — used inline if any field of design-tokens.json is
// missing or malformed. Mirrors the slate/blue/Inter baseline shipped in
// src/design-tokens.json. Keep these in sync with that file.
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

const t = tokens as DesignTokensShape;
const palette = { ...DEFAULTS.palette, ...(t.palette ?? {}) };
const typography = { ...DEFAULTS.typography, ...(t.typography ?? {}) };
const radius = { ...DEFAULTS.radius, ...(t.radius ?? {}) };

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" }
    },
    extend: {
      colors: {
        // atlas-* CSS-variable-driven theme — kept for shadcn primitives that
        // reference hsl(var(--atlas-*)) in their default styles.
        border: "hsl(var(--atlas-border))",
        input: "hsl(var(--atlas-input))",
        ring: "hsl(var(--atlas-ring))",
        destructive: {
          DEFAULT: "hsl(var(--atlas-destructive))",
          foreground: "hsl(var(--atlas-destructive-foreground))"
        },
        popover: {
          DEFAULT: "hsl(var(--atlas-popover))",
          foreground: "hsl(var(--atlas-popover-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--atlas-card))",
          foreground: "hsl(var(--atlas-card-foreground))"
        },
        // design-tokens.json-driven palette — produces utilities like
        // bg-primary, text-foreground, border-accent, etc.
        background: palette.background,
        foreground: palette.foreground,
        primary: {
          DEFAULT: palette.primary,
          foreground: palette.background
        },
        secondary: {
          DEFAULT: palette.secondary,
          foreground: palette.background
        },
        accent: {
          DEFAULT: palette.accent,
          foreground: palette.background
        },
        muted: {
          DEFAULT: palette.muted,
          foreground: palette.foreground
        }
      },
      fontFamily: {
        sans: [typography.bodyFont, "ui-sans-serif", "system-ui", "sans-serif"],
        heading: [typography.headingFont, "ui-sans-serif", "system-ui", "sans-serif"]
      },
      borderRadius: {
        DEFAULT: radius.base,
        lg: radius.base,
        md: `calc(${radius.base} - 2px)`,
        sm: `calc(${radius.base} - 4px)`
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" }
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" }
        }
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out"
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
