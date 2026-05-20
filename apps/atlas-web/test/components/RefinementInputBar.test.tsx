import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { RefinementInputBar } from "@/components/RefinementInputBar";

describe("RefinementInputBar — Plan K Task 8", () => {
  it("renders nothing when flagEnabled=false", () => {
    const { container } = render(
      <RefinementInputBar
        projectId="p"
        parentRitualId="r-1"
        flagEnabled={false}
        onRefine={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders textarea + Refine button when flagEnabled=true", () => {
    render(
      <RefinementInputBar
        projectId="p"
        parentRitualId="r-1"
        flagEnabled={true}
        onRefine={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/refine/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refine/i })).toBeInTheDocument();
  });

  it("calls onRefine with the typed text on submit", async () => {
    const onRefine = vi.fn(async () => undefined);
    render(
      <RefinementInputBar
        projectId="p"
        parentRitualId="r-1"
        flagEnabled={true}
        onRefine={onRefine}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/refine/i), { target: { value: "rename foo" } });
    fireEvent.click(screen.getByRole("button", { name: /refine/i }));
    await waitFor(() => {
      expect(onRefine).toHaveBeenCalledWith("rename foo");
    });
  });

  it("disables the button while pending", async () => {
    let resolveRefine: () => void = () => {};
    const onRefine = vi.fn(() => new Promise<void>((res) => { resolveRefine = res; }));
    render(
      <RefinementInputBar
        projectId="p"
        parentRitualId="r-1"
        flagEnabled={true}
        onRefine={onRefine}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/refine/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /refine/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /refining|refine/i })).toBeDisabled();
    });
    resolveRefine();
  });
});
