// apps/atlas-web/test/app/projects/new/PromptForm.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PromptForm } from "@/app/projects/new/_components/PromptForm";

describe("PromptForm", () => {
  it("renders 5 pills + textarea + submit", () => {
    render(<PromptForm action={vi.fn()} />);
    expect(screen.getByRole("button", { name: /website/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /backend.*api/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mobile/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /data pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /let ai decide/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/what do you want to build/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create/i })).toBeInTheDocument();
  });

  it("defaults to 'auto' kind", () => {
    render(<PromptForm action={vi.fn()} />);
    expect(screen.getByRole("button", { name: /let ai decide/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a pill makes it active and unpresses the others", () => {
    render(<PromptForm action={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /website/i }));
    expect(screen.getByRole("button", { name: /website/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /let ai decide/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("includes hidden kind input matching the selected pill", () => {
    const { container } = render(<PromptForm action={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /backend.*api/i }));
    const hidden = container.querySelector<HTMLInputElement>('input[name="kind"]');
    expect(hidden?.value).toBe("backend-rest-api");
  });
});
