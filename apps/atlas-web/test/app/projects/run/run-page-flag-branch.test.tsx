import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/app/projects/[projectId]/run/_components/HealthLightsAma", () => ({
  HealthLightsAma: ({ summary }: { summary: { light: string; availabilityRatio: number } }) => (
    <div
      data-testid="health-lights"
      data-light={summary.light}
      data-avail={String(summary.availabilityRatio)}
    />
  )
}));
vi.mock("@/app/projects/[projectId]/run/_components/EndpointTableDiego", () => ({
  EndpointTableDiego: () => <div data-testid="endpoint-table" />
}));
vi.mock("@/app/projects/[projectId]/run/_components/TraceExplorerPriya", () => ({
  TraceExplorerPriya: () => <div data-testid="trace-explorer" />
}));

const getGrafanaClientMock = vi.fn();
vi.mock("@/lib/observability/grafana", () => ({
  getGrafanaClient: () => getGrafanaClientMock()
}));

import RunDashboardPage from "@/app/projects/[projectId]/run/page";

beforeEach(() => {
  getGrafanaClientMock.mockReset();
});

async function renderPage(persona: "ama" | "diego" | "priya") {
  const tree = await RunDashboardPage({
    params: Promise.resolve({ projectId: "p-1" }),
    searchParams: Promise.resolve({ persona })
  });
  return render(tree as React.ReactElement);
}

describe("Run page — Grafana flag branch (Plan J Tasks 4-6)", () => {
  it("flag-OFF (getGrafanaClient returns undefined): renders 'unknown' light placeholder", async () => {
    getGrafanaClientMock.mockReturnValue(undefined);
    await renderPage("ama");
    expect(screen.getByTestId("health-lights").getAttribute("data-light")).toBe("unknown");
  });

  it("flag-ON: getGrafanaClient is invoked AND its result feeds computeHealthSummary", async () => {
    const stubClient = {
      queryInstant: vi.fn(async ({ query }: { query: string }) => ({
        // availability query returns 0.9999 (green); alerts returns 0
        value: query.includes("availability") ? 0.9999 : 0
      })),
      queryRange: vi.fn(async () => ({ matrix: [] }))
    };
    getGrafanaClientMock.mockReturnValue(stubClient);
    await renderPage("ama");
    const lights = screen.getByTestId("health-lights");
    expect(lights.getAttribute("data-light")).toBe("green");
    expect(lights.getAttribute("data-avail")).toBe("0.9999");
  });

  it("flag-ON but Grafana errors: computeHealthSummary degrades to 'unknown' (no page crash)", async () => {
    const errorClient = {
      queryInstant: vi.fn(async () => { throw new Error("Grafana 503"); }),
      queryRange: vi.fn(async () => { throw new Error("Grafana 503"); })
    };
    getGrafanaClientMock.mockReturnValue(errorClient);
    await renderPage("ama");
    expect(screen.getByTestId("health-lights").getAttribute("data-light")).toBe("unknown");
  });

  it("Diego persona renders endpoint table (today empty array; full wiring is a follow-up)", async () => {
    getGrafanaClientMock.mockReturnValue(undefined);
    await renderPage("diego");
    expect(screen.getByTestId("endpoint-table")).toBeInTheDocument();
  });

  it("Priya persona renders trace explorer", async () => {
    getGrafanaClientMock.mockReturnValue(undefined);
    await renderPage("priya");
    expect(screen.getByTestId("trace-explorer")).toBeInTheDocument();
  });
});
