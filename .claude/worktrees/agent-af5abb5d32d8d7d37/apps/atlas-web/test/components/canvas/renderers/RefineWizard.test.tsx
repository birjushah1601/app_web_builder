import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RefineWizard } from "@/components/canvas/renderers/RefineWizard";

describe("<RefineWizard>", () => {
  it("renders <AxisWizard> seeded with palette / typography / density axes (3 steps)", () => {
    render(<RefineWizard fromDirectionId="editorial-dark" onComplete={vi.fn()} />);
    expect(screen.getByTestId("refine-wizard-editorial-dark")).toBeInTheDocument();
    expect(screen.getByTestId("axis-wizard")).toBeInTheDocument();
    // First step is palette — we should see its label and the 3-step indicator.
    expect(screen.getByText(/pick a palette/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
  });
});
