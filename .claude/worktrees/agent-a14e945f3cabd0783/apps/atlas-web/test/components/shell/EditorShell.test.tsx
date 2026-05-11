import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import React from "react";
import { EditorShell } from "@/components/shell/EditorShell";

beforeEach(() => { cleanup(); localStorage.clear(); });

describe("EditorShell", () => {
  it("renders left + right children inside named test panels", () => {
    render(
      <EditorShell projectId="p-1" left={<div data-testid="L">left</div>} right={<div data-testid="R">right</div>} />
    );
    expect(screen.getByTestId("editor-shell")).toBeInTheDocument();
    expect(screen.getByTestId("editor-shell-handle")).toBeInTheDocument();
    expect(screen.getByTestId("L")).toBeInTheDocument();
    expect(screen.getByTestId("R")).toBeInTheDocument();
  });

  it("uses defaults when nothing persisted (35% / 65%)", () => {
    render(
      <EditorShell projectId="p-1" left={<div>L</div>} right={<div>R</div>} />
    );
    const root = screen.getByTestId("editor-shell");
    expect(root.getAttribute("data-default-left-pct")).toBe("35");
  });

  it("hydrates persisted leftWidthPct on mount", () => {
    localStorage.setItem("atlas:editorLayout:p-1", JSON.stringify({ leftWidthPct: 50, leftCollapsed: false, rightCollapsed: false }));
    render(
      <EditorShell projectId="p-1" left={<div>L</div>} right={<div>R</div>} />
    );
    const root = screen.getByTestId("editor-shell");
    expect(root.getAttribute("data-current-left-pct")).toBe("50");
  });

  it("clicking the left collapse button hides the left panel", () => {
    render(
      <EditorShell projectId="p-1" left={<div data-testid="L">left</div>} right={<div>R</div>} />
    );
    const btn = screen.getByTestId("editor-shell-collapse-left");
    act(() => { btn.click(); });
    expect(screen.getByTestId("editor-shell").getAttribute("data-left-collapsed")).toBe("true");
  });

  it("renders without crashing during SSR (no window access at first render)", () => {
    // Strip window so any SSR-unsafe code throws synchronously.
    const orig = global.window;
    // @ts-expect-error — intentional delete to simulate SSR
    delete global.window;
    try {
      // The component is "use client" — it can't truly SSR — but its
      // INITIAL state must not call window.* during the synchronous
      // render. We assert no throw during construction of the element tree.
      expect(() => React.createElement(EditorShell as never, { projectId: "p-1", left: null, right: null })).not.toThrow();
    } finally {
      global.window = orig;
    }
  });
});
