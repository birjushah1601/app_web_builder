import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { CanvasPreviewToolbar } from "@/app/projects/[projectId]/canvas/_components/CanvasPreviewToolbar";

beforeEach(() => { cleanup(); });

describe("CanvasPreviewToolbar — Plan R", () => {
  it("renders 3 segmented control options for viewport (Desktop/Tablet/Mobile)", () => {
    render(<CanvasPreviewToolbar viewport="desktop" onViewportChange={() => {}} previewUrl="https://x" onReload={() => {}} />);
    expect(screen.getByRole("radio", { name: /desktop/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /tablet/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /mobile/i })).toBeInTheDocument();
  });

  it("calls onReload when the reload button is clicked", () => {
    const onReload = vi.fn();
    render(<CanvasPreviewToolbar viewport="desktop" onViewportChange={() => {}} previewUrl="https://x" onReload={onReload} />);
    fireEvent.click(screen.getByTestId("preview-toolbar-reload"));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("renders an open-in-new-tab link with the preview URL", () => {
    render(<CanvasPreviewToolbar viewport="desktop" onViewportChange={() => {}} previewUrl="https://example.e2b.app" onReload={() => {}} />);
    const link = screen.getByTestId("preview-toolbar-open-tab") as HTMLAnchorElement;
    expect(link.href).toBe("https://example.e2b.app/");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });
});
