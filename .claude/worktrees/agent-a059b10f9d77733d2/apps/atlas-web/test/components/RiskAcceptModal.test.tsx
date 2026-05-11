import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RiskAcceptModal } from "@/components/RiskAcceptModal";

describe("RiskAcceptModal", () => {
  it("submit disabled until rationale >= 20 chars", async () => {
    render(<RiskAcceptModal open onSubmit={vi.fn()} onClose={vi.fn()} gate="L4-security" persona="diego" failureSummary="x" />);
    const submit = screen.getByRole("button", { name: /Accept risk/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/rationale/i), "short");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/rationale/i), " padded out to past twenty chars");
    expect(submit).toBeEnabled();
  });

  it("submitting calls onSubmit with the form values", async () => {
    const onSubmit = vi.fn();
    render(<RiskAcceptModal open onSubmit={onSubmit} onClose={vi.fn()} gate="L4-security" persona="diego" failureSummary="wildcard CORS" />);
    await userEvent.type(screen.getByPlaceholderText(/rationale/i), "Twenty-something chars rationale");
    await userEvent.click(screen.getByRole("button", { name: /Accept risk/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      rationale: "Twenty-something chars rationale", scope: "session"
    }));
  });
});
