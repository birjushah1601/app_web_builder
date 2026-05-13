import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectionChip } from "@/components/canvas/SelectionChip";

describe("SelectionChip", () => {
  it("renders the element label and a remove button", () => {
    render(<SelectionChip label="<h2>Welcome…</h2>" onRemove={vi.fn()} />);
    expect(screen.getByText(/welcome/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove selection/i })).toBeInTheDocument();
  });

  it("fires onRemove when the ✕ is clicked", () => {
    const onRemove = vi.fn();
    render(<SelectionChip label="<h2>x</h2>" onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /remove selection/i }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
