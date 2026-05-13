import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloatingToolbar } from "@/components/canvas/FloatingToolbar";
import type { DomNode } from "@/lib/canvas/use-element-selection";

const baseNode: DomNode = {
  selector: "h1",
  atlasId: "abc",
  tag: "h1",
  text: "Hello",
  rect: { x: 100, y: 200, width: 300, height: 40 },
  classes: []
};

describe("FloatingToolbar", () => {
  it("renders Edit text + Style + Ask AI buttons for a text element", () => {
    render(<FloatingToolbar node={baseNode} onEditText={vi.fn()} onOpenStyle={vi.fn()} onAskAi={vi.fn()} />);
    expect(screen.getByRole("button", { name: /edit text/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /style/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ask ai/i })).toBeInTheDocument();
  });

  it("renders Replace image + Alt text + Ask AI for an img element", () => {
    const img: DomNode = { ...baseNode, tag: "img" };
    render(<FloatingToolbar node={img} onEditText={vi.fn()} onOpenStyle={vi.fn()} onAskAi={vi.fn()} onReplaceImage={vi.fn()} />);
    expect(screen.getByRole("button", { name: /replace image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ask ai/i })).toBeInTheDocument();
  });

  it("fires onEditText when Edit text is clicked", () => {
    const onEditText = vi.fn();
    render(<FloatingToolbar node={baseNode} onEditText={onEditText} onOpenStyle={vi.fn()} onAskAi={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /edit text/i }));
    expect(onEditText).toHaveBeenCalledWith(baseNode);
  });
});
