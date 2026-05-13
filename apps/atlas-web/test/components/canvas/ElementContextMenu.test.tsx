import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ElementContextMenu } from "@/components/canvas/ElementContextMenu";

describe("ElementContextMenu", () => {
  it("fires onAction with the chosen op when an item is clicked", () => {
    const onAction = vi.fn();
    render(<ElementContextMenu x={10} y={20} onAction={onAction} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/delete/i));
    expect(onAction).toHaveBeenCalledWith({ kind: "delete" });
  });
});
