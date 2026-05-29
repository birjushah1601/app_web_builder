import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { TestsCanvas } from "@/components/canvas/renderers/TestsCanvas";

const ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "tests" as const,
  framework: "vitest" as const,
  specs: [
    { file: "Home.test.tsx", targets: ["frontend"], passed: 5, failed: 0, skipped: 0, durationMs: 200 },
    { file: "About.test.tsx", targets: ["frontend"], passed: 3, failed: 1, skipped: 1, durationMs: 90, lastError: "expected oops" }
  ],
  coverage: { lines: 87, branches: 70 }
};

describe("TestsCanvas", () => {
  it("renders the summary header with totals", () => {
    render(<TestsCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("tests-summary")).toHaveTextContent(/8 passed/i);
    expect(screen.getByTestId("tests-summary")).toHaveTextContent(/1 failed/i);
    expect(screen.getByTestId("tests-summary")).toHaveTextContent(/1 skipped/i);
  });
  it("renders one row per spec with status pill", () => {
    render(<TestsCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("tests-spec-row-Home.test.tsx")).toBeInTheDocument();
    expect(screen.getByTestId("tests-spec-row-About.test.tsx")).toHaveTextContent(/failed/i);
  });
  it("shows lastError when present", () => {
    render(<TestsCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("tests-spec-error-About.test.tsx")).toHaveTextContent("expected oops");
  });
  it("renders the empty-state when no artifact is set", () => {
    render(<TestsCanvas artifact={undefined} />);
    expect(screen.getByTestId("tests-canvas-empty")).toBeInTheDocument();
  });
  it("renders coverage footer when present", () => {
    render(<TestsCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("tests-coverage")).toHaveTextContent(/lines.*87/i);
    expect(screen.getByTestId("tests-coverage")).toHaveTextContent(/branches.*70/i);
  });
});
