import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthLightsAma } from "@/app/projects/[projectId]/run/_components/HealthLightsAma";

describe("HealthLightsAma", () => {
  it("renders a green light for healthy summary", () => {
    render(
      <HealthLightsAma
        summary={{
          light: "green",
          availabilityRatio: 0.9995,
          openAlerts: 0,
          windowFromIso: "2026-04-22T00:00:00.000Z",
          windowToIso: "2026-04-22T01:00:00.000Z"
        }}
      />
    );
    expect(screen.getByTestId("health-light")).toHaveAttribute("data-light", "green");
    expect(screen.getByText(/all systems normal/i)).toBeInTheDocument();
  });

  it("renders amber light + supportive copy", () => {
    render(
      <HealthLightsAma
        summary={{
          light: "amber",
          availabilityRatio: 0.995,
          openAlerts: 1,
          windowFromIso: "2026-04-22T00:00:00.000Z",
          windowToIso: "2026-04-22T01:00:00.000Z"
        }}
      />
    );
    expect(screen.getByTestId("health-light")).toHaveAttribute("data-light", "amber");
    expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  });

  it("renders red light + actionable copy", () => {
    render(
      <HealthLightsAma
        summary={{
          light: "red",
          availabilityRatio: 0.9,
          openAlerts: 3,
          windowFromIso: "2026-04-22T00:00:00.000Z",
          windowToIso: "2026-04-22T01:00:00.000Z"
        }}
      />
    );
    expect(screen.getByTestId("health-light")).toHaveAttribute("data-light", "red");
    expect(screen.getByText(/urgent/i)).toBeInTheDocument();
  });

  it("renders unknown state with neutral copy", () => {
    render(
      <HealthLightsAma
        summary={{
          light: "unknown",
          availabilityRatio: 0,
          openAlerts: 0,
          windowFromIso: "2026-04-22T00:00:00.000Z",
          windowToIso: "2026-04-22T01:00:00.000Z"
        }}
      />
    );
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
