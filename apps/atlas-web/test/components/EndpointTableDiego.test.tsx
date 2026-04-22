import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { EndpointTableDiego } from "@/app/projects/[projectId]/run/_components/EndpointTableDiego.js";

const stats = [
  { endpointId: "GET /a", requestCount: 1000, errorCount: 3, p50Ms: 80, p95Ms: 400, p99Ms: 800 },
  { endpointId: "POST /b", requestCount: 50, errorCount: 0, p50Ms: 20, p95Ms: 60, p99Ms: 100 }
];

describe("EndpointTableDiego", () => {
  it("renders one row per endpoint with the expected columns", () => {
    render(<EndpointTableDiego stats={stats} />);
    expect(screen.getByText("GET /a")).toBeInTheDocument();
    expect(screen.getByText("POST /b")).toBeInTheDocument();
    expect(screen.getByText("400ms")).toBeInTheDocument();
  });

  it("renders an empty state when no endpoints", () => {
    render(<EndpointTableDiego stats={[]} />);
    expect(screen.getByText(/no endpoint traffic/i)).toBeInTheDocument();
  });

  it("does not highlight rows below 1% error rate", () => {
    render(<EndpointTableDiego stats={stats} />);
    const aRow = screen.getByText("GET /a").closest("tr");
    expect(aRow?.dataset.highlight).toBe("false");
  });

  it("highlights rows at/above 1% error rate", () => {
    cleanup();
    const hot = [
      { endpointId: "GET /h", requestCount: 100, errorCount: 5, p50Ms: 1, p95Ms: 1, p99Ms: 1 }
    ];
    render(<EndpointTableDiego stats={hot} />);
    const hotRow = screen.getByText("GET /h").closest("tr");
    expect(hotRow?.dataset.highlight).toBe("true");
  });
});
