import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalPanel } from "@/components/ApprovalPanel.js";

describe("ApprovalPanel", () => {
  it("Ama sees Yes / No / Ask", () => {
    render(<ApprovalPanel persona="ama" artifact={{ scope: "new-feature" }} onApprove={vi.fn()} onChangesRequested={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ask/i })).toBeInTheDocument();
  });

  it("Diego sees Approve / Request changes + raw artifact preview", () => {
    render(<ApprovalPanel persona="diego" artifact={{ scope: "new-feature" }} onApprove={vi.fn()} onChangesRequested={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Request changes/i })).toBeInTheDocument();
  });

  it("Yes triggers onApprove", async () => {
    const onApprove = vi.fn();
    render(<ApprovalPanel persona="ama" artifact={{}} onApprove={onApprove} onChangesRequested={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("Request changes shows notes input + submits with text", async () => {
    const onChanges = vi.fn();
    render(<ApprovalPanel persona="diego" artifact={{}} onApprove={vi.fn()} onChangesRequested={onChanges} />);
    await userEvent.click(screen.getByRole("button", { name: /Request changes/i }));
    await userEvent.type(screen.getByPlaceholderText(/What needs to change/i), "Add RTL support");
    await userEvent.click(screen.getByRole("button", { name: /Submit/i }));
    expect(onChanges).toHaveBeenCalledWith("Add RTL support");
  });
});
