import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// FileTree is a Server Component in production; for tests we render it synchronously
// by mocking the async data-fetch so it becomes a regular function component.
vi.mock("@atlas/spec-graph-sync", () => ({
  listMirroredFiles: vi.fn().mockResolvedValue([
    "src/index.ts",
    "src/components/Button.tsx",
    "src/lib/api.ts",
    "package.json",
    "README.md",
  ]),
}));

// FileTreeClient is a pure client component — render directly
import { FileTreeClient } from "../../../components/code/FileTreeClient";

const FIXTURE_FILES = [
  "src/index.ts",
  "src/components/Button.tsx",
  "src/lib/api.ts",
  "package.json",
  "README.md",
];

describe("FileTreeClient", () => {
  it("renders all file paths as list items", () => {
    const onSelect = vi.fn();
    render(
      <FileTreeClient
        files={FIXTURE_FILES}
        selectedFile={null}
        onSelectFile={onSelect}
      />
    );
    // file name labels are visible; full path is in title attribute
    expect(screen.getByText("index.ts")).toBeInTheDocument();
    expect(screen.getByText("package.json")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(FIXTURE_FILES.length);
  });

  it("calls onSelectFile when a file is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FileTreeClient
        files={FIXTURE_FILES}
        selectedFile={null}
        onSelectFile={onSelect}
      />
    );
    fireEvent.click(screen.getByText("index.ts"));
    expect(onSelect).toHaveBeenCalledWith("src/index.ts");
  });

  it("highlights the selected file", () => {
    render(
      <FileTreeClient
        files={FIXTURE_FILES}
        selectedFile="package.json"
        onSelectFile={vi.fn()}
      />
    );
    const selected = screen.getByText("package.json").closest("button");
    expect(selected).toHaveClass("bg-zinc-700");
  });

  it("renders file name (not full path) as the visible label", () => {
    render(
      <FileTreeClient
        files={FIXTURE_FILES}
        selectedFile={null}
        onSelectFile={vi.fn()}
      />
    );
    // "Button.tsx" should be visible, not the full path
    expect(screen.getByText("Button.tsx")).toBeInTheDocument();
  });
});
