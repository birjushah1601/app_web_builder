import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxisWizard } from "@/components/a2ui/AxisWizard";

const axes = [
  {
    id: "palette",
    label: "Pick a palette",
    educationalTooltip: "A palette is the small set of colors that ties everything together. Think of it as the mood of your app.",
    options: [
      { id: "editorial", name: "Editorial", swatchSvg: "<svg/>", educationCopy: "Black + gold = serious + premium.", funFact: "Used by Eleven Madison Park." },
      { id: "warm", name: "Warm", swatchSvg: "<svg/>", educationCopy: "Cream + terracotta = friendly café.", funFact: "Common in Mediterranean cafes." },
      { id: "cool", name: "Cool", swatchSvg: "<svg/>", educationCopy: "Slate + blue = tech-forward.", funFact: "Stripe and Linear use cool tones." }
    ]
  },
  {
    id: "typography",
    label: "Pick a typography pairing",
    educationalTooltip: "Typography sets the tone before anyone reads a word.",
    options: [
      { id: "serif-sans", name: "Serif heads + sans body", swatchSvg: "<svg/>", educationCopy: "Editorial feel.", funFact: "" },
      { id: "all-sans", name: "All sans-serif", swatchSvg: "<svg/>", educationCopy: "Clean, modern.", funFact: "" }
    ]
  },
  {
    id: "density",
    label: "Pick a density",
    educationalTooltip: "Density is how packed your screen feels.",
    options: [
      { id: "spacious", name: "Spacious", swatchSvg: "<svg/>", educationCopy: "Lots of breathing room.", funFact: "" },
      { id: "comfortable", name: "Comfortable", swatchSvg: "<svg/>", educationCopy: "Balanced.", funFact: "" }
    ]
  }
];

describe("<AxisWizard>", () => {
  it("renders the first axis label and tooltip", () => {
    render(<AxisWizard axes={axes} onComplete={vi.fn()} />);
    expect(screen.getByText("Pick a palette")).toBeInTheDocument();
    expect(screen.getByText(/A palette is the small set of colors/)).toBeInTheDocument();
  });

  it("displays a step indicator (1 of 3)", () => {
    render(<AxisWizard axes={axes} onComplete={vi.fn()} />);
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
  });

  it("advances to the next axis after a selection + Next click", async () => {
    render(<AxisWizard axes={axes} onComplete={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Editorial/ }));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Pick a typography pairing")).toBeInTheDocument();
    expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument();
  });

  it("calls onComplete with all selections after the final axis", async () => {
    const onComplete = vi.fn();
    render(<AxisWizard axes={axes} onComplete={onComplete} />);
    await userEvent.click(screen.getByRole("button", { name: /Editorial/ }));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await userEvent.click(screen.getByRole("button", { name: /All sans-serif/ }));
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    await userEvent.click(screen.getByRole("button", { name: /Spacious/ }));
    await userEvent.click(screen.getByRole("button", { name: /finish/i }));
    expect(onComplete).toHaveBeenCalledWith({
      palette: "editorial",
      typography: "all-sans",
      density: "spacious"
    });
  });

  it("disables Next until an option is selected on the current axis", () => {
    render(<AxisWizard axes={axes} onComplete={vi.fn()} />);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("renders fun-fact text when provided on an option", () => {
    render(<AxisWizard axes={axes} onComplete={vi.fn()} />);
    expect(screen.getByText(/Used by Eleven Madison Park/)).toBeInTheDocument();
  });
});
