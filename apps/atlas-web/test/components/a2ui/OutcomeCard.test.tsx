import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OutcomeCard } from "@/components/a2ui/OutcomeCard";

const card = {
  id: "editorial-dark",
  name: "Editorial Dark",
  shortDescription: "Premium feel — serif heads, gold accent.",
  technicalDescription: "IBM Plex Serif + Inter + #fbbf24 accent on #0a0a0a",
  citedReferences: ["Bombay Canteen"]
};

describe("<OutcomeCard>", () => {
  it("renders the name + shortDescription (no technical jargon)", () => {
    render(<OutcomeCard card={card} recommended={false} onSelect={vi.fn()} onRefine={vi.fn()} />);
    expect(screen.getByText("Editorial Dark")).toBeInTheDocument();
    expect(screen.getByText("Premium feel — serif heads, gold accent.")).toBeInTheDocument();
    expect(screen.queryByText(/IBM Plex Serif/)).not.toBeInTheDocument();
  });

  it("shows RECOMMENDED badge when recommended=true", () => {
    render(<OutcomeCard card={card} recommended={true} onSelect={vi.fn()} onRefine={vi.fn()} />);
    expect(screen.getByText(/RECOMMENDED/i)).toBeInTheDocument();
  });

  it("displays reasoning when provided + recommended=true", () => {
    render(<OutcomeCard card={card} recommended={true} reasoning="Premium signal in your prompt." onSelect={vi.fn()} onRefine={vi.fn()} />);
    expect(screen.getByText(/Premium signal in your prompt/)).toBeInTheDocument();
  });

  it("invokes onSelect when the use-this button is clicked", async () => {
    const onSelect = vi.fn();
    render(<OutcomeCard card={card} recommended={false} onSelect={onSelect} onRefine={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /use this/i }));
    expect(onSelect).toHaveBeenCalled();
  });
});
