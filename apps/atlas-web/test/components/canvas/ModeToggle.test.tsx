import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModeToggle } from "@/components/canvas/ModeToggle";

const MODES = [
  { id: "designing", label: "Designing" },
  { id: "preview", label: "Preview" }
];

describe("<ModeToggle>", () => {
  it("renders one button per mode", () => {
    render(<ModeToggle modes={MODES} active="designing" onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Designing" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
  });

  it("calls onChange with the clicked mode id", async () => {
    const onChange = vi.fn();
    render(<ModeToggle modes={MODES} active="designing" onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(onChange).toHaveBeenCalledWith("preview");
  });

  it("marks the active mode (aria-selected + data-active=true)", () => {
    render(<ModeToggle modes={MODES} active="preview" onChange={vi.fn()} />);
    const designing = screen.getByTestId("canvas-mode-designing");
    const preview = screen.getByTestId("canvas-mode-preview");
    expect(designing.getAttribute("aria-selected")).toBe("false");
    expect(preview.getAttribute("aria-selected")).toBe("true");
    expect(preview.getAttribute("data-active")).toBe("true");
  });
});
