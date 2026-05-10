import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { EscalationDetails } from "@/lib/ritual/timelineReducer";

const mockRetryRitual = vi.fn<(input: { ritualId: string }) => Promise<{ ok: boolean; mode: "stub" | "engine.retry" }>>();

vi.mock("@/lib/actions/retryRitual", () => ({
  retryRitual: (input: { ritualId: string }) => mockRetryRitual(input)
}));

import { EscalationBanner } from "@/components/ritual/EscalationBanner";

const baseDetails: EscalationDetails = {
  failedRoleId: "developer",
  attempts: 3,
  finalError: "tool_use validation: maximum tokens exceeded",
  ritualId: "r-42"
};

describe("EscalationBanner", () => {
  beforeEach(() => {
    mockRetryRitual.mockReset();
    mockRetryRitual.mockResolvedValue({ ok: true, mode: "stub" });
  });

  it("renders failedRoleId, attempts, and finalError", () => {
    render(<EscalationBanner details={baseDetails} />);
    expect(screen.getByTestId("escalation-banner")).toBeInTheDocument();
    expect(screen.getByTestId("escalation-role")).toHaveTextContent("developer");
    expect(screen.getByTestId("escalation-attempts")).toHaveTextContent("3 attempts");
    expect(screen.getByTestId("escalation-error")).toHaveTextContent("tool_use validation");
  });

  it("uses the role 'alert' for screen-reader urgency", () => {
    render(<EscalationBanner details={baseDetails} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("uses singular 'attempt' for attempts === 1", () => {
    render(<EscalationBanner details={{ ...baseDetails, attempts: 1 }} />);
    expect(screen.getByTestId("escalation-attempts")).toHaveTextContent("1 attempt");
  });

  it("hides the attempts pill when attempts is undefined", () => {
    const { failedRoleId, finalError, ritualId } = baseDetails;
    render(<EscalationBanner details={{ failedRoleId, finalError, ritualId }} />);
    expect(screen.queryByTestId("escalation-attempts")).not.toBeInTheDocument();
  });

  it("shows '(no error message provided)' when finalError is undefined", () => {
    const { failedRoleId, attempts, ritualId } = baseDetails;
    render(<EscalationBanner details={{ failedRoleId, attempts, ritualId }} />);
    expect(screen.getByTestId("escalation-error")).toHaveTextContent("(no error message provided)");
  });

  it("truncates finalError longer than 200 chars and shows expander", () => {
    const longError = "x".repeat(500);
    render(<EscalationBanner details={{ ...baseDetails, finalError: longError }} />);
    const errorEl = screen.getByTestId("escalation-error");
    // Truncated rendering ends with ellipsis
    expect(errorEl.textContent ?? "").toMatch(/x{200}…$/);
    expect(screen.getByTestId("escalation-expand")).toHaveTextContent("Show full error");
    // Click to expand → full text visible, button label flips
    fireEvent.click(screen.getByTestId("escalation-expand"));
    expect(errorEl.textContent ?? "").toBe(longError);
    expect(screen.getByTestId("escalation-expand")).toHaveTextContent("Hide full error");
  });

  it("does not render the expander for short errors", () => {
    render(<EscalationBanner details={{ ...baseDetails, finalError: "boom" }} />);
    expect(screen.queryByTestId("escalation-expand")).not.toBeInTheDocument();
  });

  it("invokes retryRitual with ritualId when Retry clicked", async () => {
    render(<EscalationBanner details={baseDetails} />);
    fireEvent.click(screen.getByTestId("escalation-retry"));
    // useTransition resolves microtasks; await the mock call.
    await vi.waitFor(() => expect(mockRetryRitual).toHaveBeenCalledOnce());
    expect(mockRetryRitual).toHaveBeenCalledWith({ ritualId: "r-42" });
  });

  it("shows ack message after a successful retry", async () => {
    render(<EscalationBanner details={baseDetails} />);
    fireEvent.click(screen.getByTestId("escalation-retry"));
    await vi.waitFor(() =>
      expect(screen.queryByTestId("escalation-retry-ack")).toBeInTheDocument()
    );
  });

  it("disables Retry when ritualId is missing", () => {
    const { failedRoleId, attempts, finalError } = baseDetails;
    render(<EscalationBanner details={{ failedRoleId, attempts, finalError }} />);
    const button = screen.getByTestId("escalation-retry") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("uses the bg-red-50/border-red-200/text-red-900 styling required by the spec", () => {
    render(<EscalationBanner details={baseDetails} />);
    const banner = screen.getByTestId("escalation-banner");
    expect(banner.className).toContain("bg-red-50");
    expect(banner.className).toContain("border-red-200");
    expect(banner.className).toContain("text-red-900");
    expect(banner.className).toContain("rounded-md");
    expect(banner.className).toContain("p-3");
    expect(banner.className).toContain("mt-2");
  });
});

