import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DesignerCanvas } from "@/components/canvas/renderers/DesignerCanvas";

const TOKENS = {
  palette: { primary: "#000000", accent: "#fbbf24", surface: "#fafafa", text: "#0a0a0a", muted: "#888888" },
  typeScale: { sansFamily: "Inter", monoFamily: "Geist Mono", baseSizePx: 16, scale: "minor-third" as const },
  density: "comfortable" as const,
  componentSet: "shadcn" as const,
  imageryStrategy: "photo" as const,
  copyVoice: "premium" as const
};

const PROPOSAL = {
  recommended: {
    id: "editorial-dark",
    name: "Editorial Dark",
    shortDescription: "Premium feel — serif heads, gold accent.",
    technicalDescription: "IBM Plex Serif + Inter + #fbbf24 accent on #0a0a0a",
    citedReferences: ["Bombay Canteen"],
    tokens: TOKENS
  },
  alternates: [
    { id: "warm-cafe", name: "Warm Café", shortDescription: "Friendly.", technicalDescription: "cream + terracotta", citedReferences: [], tokens: TOKENS },
    { id: "modern-min", name: "Modern Minimal", shortDescription: "Clean.", technicalDescription: "monochrome", citedReferences: [], tokens: TOKENS }
  ] as const,
  reasoning: "Premium signal in your prompt."
};

describe("<DesignerCanvas>", () => {
  it("renders <OptionsCard> populated from the proposal", () => {
    render(
      <DesignerCanvas
        proposal={PROPOSAL as never}
        persona="diego"
        onSelect={vi.fn()}
        onRefine={vi.fn()}
      />
    );
    expect(screen.getByTestId("designer-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("options-card")).toBeInTheDocument();
    expect(screen.getByText("Editorial Dark")).toBeInTheDocument();
    expect(screen.getByText("Warm Café")).toBeInTheDocument();
    expect(screen.getByText("Modern Minimal")).toBeInTheDocument();
    expect(screen.getByText(/Premium signal/)).toBeInTheDocument();
  });
});
