import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShareableUrlModal } from "../app/projects/[projectId]/canvas/_components/ShareableUrlModal.js";

// Mock the Server Action — it's server-side only, not callable in test env
vi.mock("../lib/actions/sandbox.js", () => ({
  createShareableUrl: vi.fn().mockResolvedValue({
    url: "https://example.com/preview/abc",
    accessMode: "auth",
    expiresAt: new Date().toISOString(),
  }),
}));

describe("ShareableUrlModal", () => {
  it("renders with auth mode selected by default", () => {
    render(
      <ShareableUrlModal
        projectId="p-1"
        sandboxId="sbx_share_test"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    const authRadio = screen.getByRole("radio", { name: /requires sign-in/i });
    expect((authRadio as HTMLInputElement).checked).toBe(true);
  });

  it("shows a password input when password mode is selected", () => {
    render(
      <ShareableUrlModal
        projectId="p-1"
        sandboxId="sbx_share_test"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: /password/i }));
    expect(screen.getByLabelText(/shared password/i)).toBeTruthy();
  });

  it("shows a public-mode confirmation checkbox when public is selected", () => {
    render(
      <ShareableUrlModal
        projectId="p-1"
        sandboxId="sbx_share_test"
        isOpen={true}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("radio", { name: /public/i }));
    expect(screen.getByRole("checkbox", { name: /i understand/i })).toBeTruthy();
  });

  it("calls onClose when the cancel button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ShareableUrlModal
        projectId="p-1"
        sandboxId="sbx_share_test"
        isOpen={true}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ShareableUrlModal
        projectId="p-1"
        sandboxId="sbx_share_test"
        isOpen={false}
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
