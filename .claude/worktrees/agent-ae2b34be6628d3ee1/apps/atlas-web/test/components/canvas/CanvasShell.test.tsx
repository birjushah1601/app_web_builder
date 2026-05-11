import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasModeRegistry, type CanvasManifest } from "@atlas/canvas-runtime";
import { CanvasShell } from "@/components/canvas/CanvasShell";

const MANIFEST: CanvasManifest = {
  artifactKind: "frontend-app",
  modes: [
    { id: "designing", renderer: "designing-r", audience: ["ama", "diego"], default: true },
    { id: "preview", renderer: "preview-r", audience: ["ama", "diego"] },
    // diego-only mode — filtered out for ama
    { id: "schema", renderer: "schema-r", audience: ["diego"] }
  ]
};

function mkRegistry() {
  const reg = new CanvasModeRegistry<React.ComponentType<unknown>>();
  reg.register("designing-r", () => <div data-testid="rdr-designing">designing renderer</div>);
  reg.register("preview-r", () => <div data-testid="rdr-preview">preview renderer</div>);
  reg.register("schema-r", () => <div data-testid="rdr-schema">schema renderer</div>);
  return reg;
}

describe("<CanvasShell>", () => {
  it("renders <EmptyCanvas> when no manifest is supplied", () => {
    render(<CanvasShell manifest={undefined} persona="ama" registry={mkRegistry()} />);
    expect(screen.getByTestId("empty-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-shell")).not.toBeInTheDocument();
  });

  it("renders the manifest's default mode initially", () => {
    render(<CanvasShell manifest={MANIFEST} persona="diego" registry={mkRegistry()} />);
    expect(screen.getByTestId("rdr-designing")).toBeInTheDocument();
    expect(screen.queryByTestId("rdr-preview")).not.toBeInTheDocument();
  });

  it("persona filter narrows the visible modes (ama sees no diego-only schema mode)", () => {
    render(<CanvasShell manifest={MANIFEST} persona="ama" registry={mkRegistry()} />);
    // ama gets both designing + preview but NOT schema.
    expect(screen.getByRole("tab", { name: "designing" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "preview" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "schema" })).not.toBeInTheDocument();
  });

  it("clicking a mode tab swaps the rendered mode", async () => {
    render(<CanvasShell manifest={MANIFEST} persona="diego" registry={mkRegistry()} />);
    expect(screen.getByTestId("rdr-designing")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "preview" }));
    expect(screen.getByTestId("rdr-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("rdr-designing")).not.toBeInTheDocument();
  });
});
