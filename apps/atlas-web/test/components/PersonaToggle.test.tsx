import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonaToggle } from "@/components/PersonaToggle.js";

describe("PersonaToggle", () => {
  it("renders three buttons reflecting the current persona", () => {
    const onChange = vi.fn();
    render(<PersonaToggle current="diego" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /Ama/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Diego/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Priya/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange when clicking a different persona", async () => {
    const onChange = vi.fn();
    render(<PersonaToggle current="ama" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Priya/i }));
    expect(onChange).toHaveBeenCalledWith("priya");
  });
});
