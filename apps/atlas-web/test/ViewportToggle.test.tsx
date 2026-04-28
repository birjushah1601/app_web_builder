import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViewportToggle, VIEWPORTS } from "../app/projects/[projectId]/canvas/_components/ViewportToggle";

describe("ViewportToggle", () => {
  it("renders all three viewport buttons", () => {
    render(<ViewportToggle viewport="desktop" onViewportChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /desktop/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /tablet/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /mobile/i })).toBeTruthy();
  });

  it("marks the active viewport with aria-pressed=true", () => {
    render(<ViewportToggle viewport="tablet" onViewportChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /tablet/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /desktop/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onViewportChange with the selected viewport id when a button is clicked", () => {
    const onChange = vi.fn();
    render(<ViewportToggle viewport="desktop" onViewportChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /mobile/i }));
    expect(onChange).toHaveBeenCalledWith("mobile");
  });

  it("VIEWPORTS constant has correct dimensions for all three presets", () => {
    expect(VIEWPORTS.desktop).toEqual({ width: 1440, height: 900 });
    expect(VIEWPORTS.tablet).toEqual({ width: 768, height: 1024 });
    expect(VIEWPORTS.mobile).toEqual({ width: 375, height: 667 });
  });
});
