import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageReplacePopover } from "@/components/canvas/ImageReplacePopover";

vi.mock("@/lib/actions/regenerateElementImage", () => ({
  regenerateElementImage: vi.fn().mockResolvedValue({ ok: true, url: "/atlas-assets/gen.jpg" })
}));

describe("ImageReplacePopover", () => {
  it("renders drop zone + URL input", () => {
    render(<ImageReplacePopover onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/drop an image/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/paste url/i)).toBeInTheDocument();
  });

  it("submits the typed URL", () => {
    const onSubmit = vi.fn();
    render(<ImageReplacePopover onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/paste url/i), { target: { value: "/new.jpg" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSubmit).toHaveBeenCalledWith({ url: "/new.jpg" });
  });

  it("calls regenerateElementImage when the Generate button is clicked", async () => {
    const { regenerateElementImage } = await import("@/lib/actions/regenerateElementImage");
    const onSubmit = vi.fn();
    render(<ImageReplacePopover onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/describe/i), { target: { value: "a sunset" } });
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(regenerateElementImage).toHaveBeenCalledWith({ instruction: "a sunset" });
    expect(onSubmit).toHaveBeenCalledWith({ url: "/atlas-assets/gen.jpg" });
  });
});
