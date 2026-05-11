import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EmptyCanvas from "@/components/canvas/EmptyCanvas";

describe("<EmptyCanvas>", () => {
  it("renders the 'ritual not started' empty-state copy", () => {
    render(<EmptyCanvas />);
    expect(screen.getByText(/ritual not started/i)).toBeInTheDocument();
  });
});
