import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { useRefinementThread } from "@/lib/refinement/useRefinementThread";

function Probe({ projectId, ritualId }: { projectId: string; ritualId: string }) {
  const { thread, loading, error } = useRefinementThread(projectId, ritualId);
  if (loading) return <div data-testid="loading" />;
  if (error)   return <div data-testid="error">{error.message}</div>;
  return <div data-testid="ok" data-count={thread.length}>{thread.map((r) => r.ritualId ?? "?").join(",")}</div>;
}

describe("useRefinementThread — Plan K Task 7", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as never;
  });

  it("starts loading, then resolves with thread array", async () => {
    (global.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ thread: [
        { ritualId: "r-root", parentRitualId: undefined },
        { ritualId: "r-leaf", parentRitualId: "r-root" }
      ] })
    });
    render(<Probe projectId="p" ritualId="r-leaf" />);
    expect(screen.getByTestId("loading")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("ok").getAttribute("data-count")).toBe("2");
    });
  });

  it("surfaces error when the API returns non-200", async () => {
    (global.fetch as never as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ error: "ritual not found" })
    });
    render(<Probe projectId="p" ritualId="r-?" />);
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toMatch(/not found|404/i);
    });
  });

  it("re-fetches when ritualId changes", async () => {
    (global.fetch as never as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ thread: [{ ritualId: "r-A" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ thread: [{ ritualId: "r-B" }] }) });
    const { rerender } = render(<Probe projectId="p" ritualId="r-A" />);
    await waitFor(() => expect(screen.getByTestId("ok").textContent).toBe("r-A"));
    rerender(<Probe projectId="p" ritualId="r-B" />);
    await waitFor(() => expect(screen.getByTestId("ok").textContent).toBe("r-B"));
  });
});
