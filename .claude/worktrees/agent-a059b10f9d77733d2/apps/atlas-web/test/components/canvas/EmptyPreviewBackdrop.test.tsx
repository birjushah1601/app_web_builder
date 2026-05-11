import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyPreviewBackdrop } from "@/app/projects/[projectId]/canvas/_components/EmptyPreviewBackdrop";

describe("EmptyPreviewBackdrop", () => {
  it("renders the dotted backdrop + provided status text in font-mono", () => {
    render(<EmptyPreviewBackdrop status="provisioning sandbox · ~5s" />);
    const root = screen.getByTestId("empty-preview-backdrop");
    expect(root).toBeInTheDocument();
    expect(root.className).toMatch(/font-mono/);
    expect(root.textContent).toContain("provisioning sandbox · ~5s");
  });
});
