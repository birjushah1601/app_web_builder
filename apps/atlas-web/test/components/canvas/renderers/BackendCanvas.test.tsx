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

  it("shows the empty-state placeholder when every previewUrl source is undefined", () => {
    const { previewUrl: _drop, ...artifactWithoutUrl } = ARTIFACT;
    render(<BackendCanvas artifact={artifactWithoutUrl} previewUrl={undefined} />);
    expect(screen.getByTestId("backend-canvas-no-preview")).toBeInTheDocument();
  });

  it("falls back to artifact.previewUrl when no explicit prop is set", () => {
    render(<BackendCanvas artifact={ARTIFACT} />);
    const iframe = screen.getByTestId("backend-swagger-iframe");
    expect(iframe).toHaveAttribute("src", "https://sb-1.preview/docs");
  });

  it("prefers backendPreviewUrl over artifact.previewUrl and the frontend previewUrl", () => {
    render(
      <BackendCanvas
        artifact={ARTIFACT}
        previewUrl="https://frontend-dev"
        backendPreviewUrl="https://backend-sb-1"
      />
    );
    const iframe = screen.getByTestId("backend-swagger-iframe");
    expect(iframe).toHaveAttribute("src", "https://backend-sb-1/docs");
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
