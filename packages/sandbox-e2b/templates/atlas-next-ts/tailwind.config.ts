import type { Config } from "tailwindcss";

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
        border: "hsl(var(--atlas-border))",
        input: "hsl(var(--atlas-input))",
        ring: "hsl(var(--atlas-ring))",
        background: "hsl(var(--atlas-background))",
        foreground: "hsl(var(--atlas-foreground))",
        primary: {
          DEFAULT: "hsl(var(--atlas-primary))",
          foreground: "hsl(var(--atlas-primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--atlas-secondary))",
          foreground: "hsl(var(--atlas-secondary-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--atlas-destructive))",
          foreground: "hsl(var(--atlas-destructive-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--atlas-muted))",
          foreground: "hsl(var(--atlas-muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--atlas-accent))",
          foreground: "hsl(var(--atlas-accent-foreground))"
        },
        popover: {
          DEFAULT: "hsl(var(--atlas-popover))",
          foreground: "hsl(var(--atlas-popover-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--atlas-card))",
          foreground: "hsl(var(--atlas-card-foreground))"
        }
      },
      borderRadius: {
        lg: "var(--atlas-radius)",
        md: "calc(var(--atlas-radius) - 2px)",
        sm: "calc(var(--atlas-radius) - 4px)"
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
