import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// Mock @monaco-editor/react — it depends on browser APIs not available in jsdom
vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
    language,
    "data-testid": testId,
  }: {
    value: string;
    onChange?: (v: string | undefined) => void;
    language?: string;
    "data-testid"?: string;
  }) => (
    <textarea
      data-testid={testId ?? "monaco-editor"}
      data-language={language}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      readOnly={!onChange}
    />
  ),
  DiffEditor: ({
    original,
    modified,
  }: {
    original: string;
    modified: string;
  }) => (
    <div data-testid="monaco-diff-editor">
      <span data-testid="diff-original">{original}</span>
      <span data-testid="diff-modified">{modified}</span>
    </div>
  ),
}));

// Mock the classifyEdit and ritual engine
vi.mock("../../../lib/code/editClassifier.js", () => ({
  classifyEdit: vi.fn().mockReturnValue("cosmetic"),
}));

vi.mock("@atlas/ritual-engine", () => ({
  RitualEngine: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue({ ritualId: "r-1" }),
  })),
}));

import { MonacoEditorWrapper } from "../../../components/code/MonacoEditorWrapper.js";

describe("MonacoEditorWrapper", () => {
  const defaultProps = {
    projectId: "p-1",
    filePath: "src/index.ts",
    initialContent: "export const x = 1;",
    language: "typescript",
    onSave: vi.fn(),
  };

  it("renders with the initial content", () => {
    render(<MonacoEditorWrapper {...defaultProps} />);
    const editor = screen.getByTestId("monaco-editor") as HTMLTextAreaElement;
    expect(editor.value).toBe("export const x = 1;");
  });

  it("shows the correct language attribute", () => {
    render(<MonacoEditorWrapper {...defaultProps} />);
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-language", "typescript");
  });

  it("calls onSave when content changes and save is triggered", async () => {
    const onSave = vi.fn();
    render(<MonacoEditorWrapper {...defaultProps} onSave={onSave} />);
    const editor = screen.getByTestId("monaco-editor");
    fireEvent.change(editor, { target: { value: "export const x = 2;" } });
    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ content: "export const x = 2;" })
    );
  });

  it("displays a dirty indicator when content has changed", () => {
    render(<MonacoEditorWrapper {...defaultProps} />);
    const editor = screen.getByTestId("monaco-editor");
    fireEvent.change(editor, { target: { value: "changed" } });
    expect(screen.getByTestId("dirty-indicator")).toBeInTheDocument();
  });
});
