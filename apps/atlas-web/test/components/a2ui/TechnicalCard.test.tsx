import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TechnicalCard } from "@/components/a2ui/TechnicalCard";

const card = {
  id: "editorial-dark",
  name: "Editorial Dark",
  shortDescription: "Premium feel — serif heads, gold accent.",
  technicalDescription: "IBM Plex Serif + Inter + #fbbf24 accent on #0a0a0a",
  citedReferences: ["Bombay Canteen", "Eleven Madison Park"]
};

describe("<TechnicalCard>", () => {
  it("renders the name + technicalDescription with code-style detail", () => {
    render(<TechnicalCard card={card} recommended={false} onSelect={vi.fn()} onRefine={vi.fn()} />);
    expect(screen.getByText("Editorial Dark")).toBeInTheDocument();
    expect(screen.getByText(/IBM Plex Serif \+ Inter/)).toBeInTheDocument();
  });

  it("shows cited references", () => {
    render(<TechnicalCard card={card} recommended={false} onSelect={vi.fn()} onRefine={vi.fn()} />);
    expect(screen.getByText(/Bombay Canteen/)).toBeInTheDocument();
    expect(screen.getByText(/Eleven Madison Park/)).toBeInTheDocument();
  });

  it("invokes onSelect on use-this click", async () => {
    const onSelect = vi.fn();
    render(<TechnicalCard card={card} recommended={false} onSelect={onSelect} onRefine={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /use this/i }));
    expect(onSelect).toHaveBeenCalled();
  });

  it("invokes onRefine on refine click", async () => {
    const onRefine = vi.fn();
    render(<TechnicalCard card={card} recommended={false} onSelect={vi.fn()} onRefine={onRefine} />);
    await userEvent.click(screen.getByRole("button", { name: /refine/i }));
    expect(onRefine).toHaveBeenCalled();
  });
});
