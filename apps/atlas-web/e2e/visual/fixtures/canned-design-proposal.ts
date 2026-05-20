// Deterministic DesignProposal used by every fixture route that renders
// an OptionsCard / OutcomeCard / TechnicalCard. Keeping this in one place
// means a baseline regenerates only when copy or shape intentionally
// changes — never as a side-effect of upstream LLM drift.

export const cannedProposal = {
  recommended: {
    id: "editorial-dark",
    name: "Editorial Dark",
    shortDescription: "Premium feel — serif heads, gold accent.",
    technicalDescription: "IBM Plex Serif + Inter + #fbbf24 accent on #0a0a0a",
    citedReferences: ["Bombay Canteen", "Eleven Madison Park"],
    tokens: {
      palette: {
        primary: "#0a0a0a",
        accent: "#fbbf24",
        surface: "#ffffff",
        text: "#0a0a0a",
        muted: "#94a3b8"
      },
      typeScale: {
        sansFamily: "Inter",
        serifFamily: "IBM Plex Serif",
        monoFamily: "JetBrains Mono",
        baseSizePx: 16,
        scale: "minor-third" as const
      },
      density: "spacious" as const,
      componentSet: "shadcn" as const,
      imageryStrategy: "photo" as const,
      copyVoice: "premium" as const
    }
  },
  alternates: [
    {
      id: "warm-cafe",
      name: "Warm Café",
      shortDescription: "Friendly neighborhood feel.",
      technicalDescription: "Hand-drawn + cream + terracotta",
      citedReferences: [],
      tokens: {} as never
    },
    {
      id: "modern-minimal",
      name: "Modern Minimal",
      shortDescription: "Tech-forward, less moody.",
      technicalDescription: "Inter + monochrome + grid-led",
      citedReferences: [],
      tokens: {} as never
    }
  ],
  reasoning:
    "Premium signal in your prompt — fine-dining Bandra category averages high on editorial-dark aesthetics."
};
