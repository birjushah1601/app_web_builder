import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RitualTimelineRow } from "@/components/ritual/RitualTimelineRow";
import type { RowState } from "@/lib/ritual/timelineReducer";

const baseRow = (overrides: Partial<RowState> = {}): RowState => ({
  phase: "architect", status: "pending", retries: 0, ...overrides
});

describe("RitualTimelineRow — status icon + title", () => {
  it("pending status renders ○ glyph + the row's title", () => {
    render(<RitualTimelineRow row={baseRow()} title="Architect planning" />);
    expect(screen.getByText("○")).toBeInTheDocument();
    expect(screen.getByText("Architect planning")).toBeInTheDocument();
  });

  it("active status renders ● glyph (filled circle)", () => {
    render(<RitualTimelineRow row={baseRow({ status: "active" })} title="Developer writing" />);
    expect(screen.getByText("●")).toBeInTheDocument();
  });

  it("done status renders ✓ glyph (check mark)", () => {
    render(<RitualTimelineRow row={baseRow({ status: "done" })} title="Architect planning" />);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("failed status renders ✗ glyph (ballot x)", () => {
    render(<RitualTimelineRow row={baseRow({ status: "failed" })} title="Developer writing" />);
    expect(screen.getByText("✗")).toBeInTheDocument();
  });
});

describe("RitualTimelineRow — duration badge", () => {
  it("renders durationMs as seconds with one decimal when present", () => {
    render(<RitualTimelineRow row={baseRow({ status: "done", durationMs: 1_240 })} title="Architect" />);
    expect(screen.getByText("1.2s")).toBeInTheDocument();
  });

  it("renders no duration badge when durationMs is undefined", () => {
    render(<RitualTimelineRow row={baseRow({ status: "active" })} title="Architect" />);
    expect(screen.queryByTestId("ritual-row-duration")).not.toBeInTheDocument();
  });
});

import userEvent from "@testing-library/user-event";

describe("RitualTimelineRow — chevron expand/collapse", () => {
  it("renders a chevron toggle button", () => {
    render(<RitualTimelineRow row={baseRow({ status: "done", retries: 1, lastError: "timeout" })} title="Architect" />);
    expect(screen.getByRole("button", { name: /expand details|collapse details/i })).toBeInTheDocument();
  });

  it("detail panel is hidden by default", () => {
    render(<RitualTimelineRow row={baseRow({ status: "done", retries: 2, lastError: "timeout 300s" })} title="Architect" />);
    expect(screen.queryByTestId("ritual-row-detail")).not.toBeInTheDocument();
  });

  it("clicking the chevron expands the detail panel and shows retry count + last error", async () => {
    render(
      <RitualTimelineRow
        row={baseRow({ status: "done", retries: 2, lastError: "provider timeout 300s" })}
        title="Architect planning"
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /expand details/i }));
    const detail = screen.getByTestId("ritual-row-detail");
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveTextContent("retried 2×");
    expect(detail).toHaveTextContent("provider timeout 300s");
  });

  it("clicking again collapses the panel", async () => {
    render(<RitualTimelineRow row={baseRow({ status: "done", retries: 1 })} title="Architect" />);
    const btn = screen.getByRole("button", { name: /expand details/i });
    await userEvent.click(btn);
    expect(screen.getByTestId("ritual-row-detail")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /collapse details/i }));
    expect(screen.queryByTestId("ritual-row-detail")).not.toBeInTheDocument();
  });

  it("detail panel shows meta.winner and meta.filesWritten when present", async () => {
    render(
      <RitualTimelineRow
        row={baseRow({
          phase: "developer",
          status: "done",
          retries: 0,
          meta: { winner: "anthropic", filesWritten: 6 }
        })}
        title="Developer writing"
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /expand details/i }));
    const detail = screen.getByTestId("ritual-row-detail");
    expect(detail).toHaveTextContent("winner: anthropic");
    expect(detail).toHaveTextContent("files: 6");
  });

  it("detail panel renders nothing-of-substance when row has no retries / error / meta", async () => {
    render(<RitualTimelineRow row={baseRow({ status: "active" })} title="Architect" />);
    await userEvent.click(screen.getByRole("button", { name: /expand details/i }));
    const detail = screen.getByTestId("ritual-row-detail");
    expect(detail).toHaveTextContent("No additional detail.");
  });
});
