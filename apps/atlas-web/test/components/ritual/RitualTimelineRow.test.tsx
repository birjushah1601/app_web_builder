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
