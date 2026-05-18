import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeToolbar } from "@/components/canvas/ModeToolbar";

describe("<ModeToolbar>", () => {
  it("toggles between three modes via radio role", () => {
    const onChange = vi.fn();
    render(<ModeToolbar mode="agent" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /visual edits/i }));
    expect(onChange).toHaveBeenCalledWith("visual-edits");
  });

  it("marks the active mode with aria-checked=true", () => {
    render(<ModeToolbar mode="plan" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /agent/i }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: /^plan$/i }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /visual edits/i }).getAttribute("aria-checked")).toBe("false");
  });

  it("renders three radio buttons", () => {
    render(<ModeToolbar mode="agent" onChange={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
});
