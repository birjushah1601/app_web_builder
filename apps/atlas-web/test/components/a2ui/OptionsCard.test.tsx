import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptionsCard } from "@/components/a2ui/OptionsCard";

const recommended = {
  id: "editorial-dark",
  name: "Editorial Dark",
  shortDescription: "Premium feel — serif heads, gold accent.",
  technicalDescription: "IBM Plex Serif + Inter + #fbbf24 accent on #0a0a0a",
  citedReferences: ["Bombay Canteen", "Eleven Madison Park"],
  cardPayload: {}
};
const alternate1 = { ...recommended, id: "warm-cafe", name: "Warm Café", shortDescription: "Friendly neighborhood feel.", technicalDescription: "Hand-drawn + cream + terracotta", citedReferences: [] };
const alternate2 = { ...recommended, id: "modern-minimal", name: "Modern Minimal", shortDescription: "Tech-forward, less moody.", technicalDescription: "Inter + monochrome + grid-led", citedReferences: [] };

describe("<OptionsCard>", () => {
  it("renders the recommendation prominently with RECOMMENDED badge", () => {
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={vi.fn()} persona="ama" reasoning="Premium signal in your prompt." />);
    expect(screen.getByText("Editorial Dark")).toBeInTheDocument();
    expect(screen.getByText(/RECOMMENDED/i)).toBeInTheDocument();
  });

  it("renders both alternates", () => {
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={vi.fn()} persona="diego" reasoning="" />);
    expect(screen.getByText("Warm Café")).toBeInTheDocument();
    expect(screen.getByText("Modern Minimal")).toBeInTheDocument();
  });

  it("uses OutcomeCard renderer when persona=ama (no jargon)", () => {
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={vi.fn()} persona="ama" reasoning="" />);
    expect(screen.getByText("Premium feel — serif heads, gold accent.")).toBeInTheDocument();
    expect(screen.queryByText(/IBM Plex Serif \+ Inter/)).not.toBeInTheDocument();
  });

  it("uses TechnicalCard renderer when persona=diego (shows technical details)", () => {
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={vi.fn()} persona="diego" reasoning="" />);
    expect(screen.getByText(/IBM Plex Serif \+ Inter/)).toBeInTheDocument();
  });

  it("invokes onSelect with direction id when 'Use this' clicked", async () => {
    const onSelect = vi.fn();
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={onSelect} onRefine={vi.fn()} persona="diego" reasoning="" />);
    await userEvent.click(screen.getByRole("button", { name: /use this/i }));
    expect(onSelect).toHaveBeenCalledWith("editorial-dark");
  });

  it("invokes onRefine when 'Refine' clicked", async () => {
    const onRefine = vi.fn();
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={onRefine} persona="diego" reasoning="" />);
    await userEvent.click(screen.getByRole("button", { name: /refine/i }));
    expect(onRefine).toHaveBeenCalledWith("editorial-dark");
  });

  it("displays reasoning under the recommended card when provided", () => {
    render(<OptionsCard recommended={recommended} alternates={[alternate1, alternate2]} onSelect={vi.fn()} onRefine={vi.fn()} persona="diego" reasoning="Premium signal in your prompt." />);
    expect(screen.getByText(/Premium signal in your prompt/)).toBeInTheDocument();
  });
});
