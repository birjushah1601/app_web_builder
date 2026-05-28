import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { BackendCanvas } from "@/components/canvas/renderers/BackendCanvas";

const ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "backend-rest-api" as const,
  openApiSpec: { openapi: "3.1.0", paths: {} },
  routes: [{ method: "get" as const, path: "/health", opId: "get_health" }],
  envContract: [],
  sandboxId: "sb-1",
  previewUrl: "https://sb-1.preview"
};

describe("BackendCanvas", () => {
  it("renders an iframe pointed at {previewUrl}/docs", () => {
    render(<BackendCanvas artifact={ARTIFACT} previewUrl={ARTIFACT.previewUrl} />);
    const iframe = screen.getByTestId("backend-swagger-iframe");
    expect(iframe).toHaveAttribute("src", "https://sb-1.preview/docs");
  });

  it("shows the empty-state placeholder when previewUrl is undefined", () => {
    render(<BackendCanvas artifact={ARTIFACT} previewUrl={undefined} />);
    expect(screen.getByTestId("backend-canvas-no-preview")).toBeInTheDocument();
  });

  it("copy-curl button writes a curl command for the first route to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<BackendCanvas artifact={ARTIFACT} previewUrl={ARTIFACT.previewUrl} />);
    fireEvent.click(screen.getByTestId("backend-copy-curl"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("curl"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("https://sb-1.preview/health"));
  });

  it("disables copy-curl when there are no routes", () => {
    render(<BackendCanvas artifact={{ ...ARTIFACT, routes: [] }} previewUrl={ARTIFACT.previewUrl} />);
    expect(screen.getByTestId("backend-copy-curl")).toBeDisabled();
  });
});
