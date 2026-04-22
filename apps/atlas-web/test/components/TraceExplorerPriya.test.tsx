import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TraceExplorerPriya } from "@/app/projects/[projectId]/run/_components/TraceExplorerPriya.js";

const traces = [
  {
    traceId: "0".repeat(32),
    rootEndpoint: "GET /api/users",
    durationMs: 320,
    errorOccurred: false,
    startedAtIso: "2026-04-22T00:00:00.000Z"
  },
  {
    traceId: "1".repeat(32),
    rootEndpoint: "POST /api/orders",
    durationMs: 1200,
    errorOccurred: true,
    startedAtIso: "2026-04-22T00:01:00.000Z"
  }
];

describe("TraceExplorerPriya", () => {
  it("renders a row per trace with deep-link to the configured backend", () => {
    render(
      <TraceExplorerPriya
        traces={traces}
        grafanaTraceUrlBase="https://grafana.atlas.app/explore?orgId=1&traceId="
      />
    );
    const link = screen.getByText("GET /api/users").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "https://grafana.atlas.app/explore?orgId=1&traceId=" + "0".repeat(32)
    );
  });

  it("marks errored traces with data-errored=true", () => {
    render(<TraceExplorerPriya traces={traces} grafanaTraceUrlBase="https://x" />);
    const row = screen.getByText("POST /api/orders").closest("tr");
    expect(row?.dataset.errored).toBe("true");
  });

  it("renders an empty state when no traces", () => {
    render(<TraceExplorerPriya traces={[]} grafanaTraceUrlBase="https://x" />);
    expect(screen.getByText(/no traces/i)).toBeInTheDocument();
  });
});
