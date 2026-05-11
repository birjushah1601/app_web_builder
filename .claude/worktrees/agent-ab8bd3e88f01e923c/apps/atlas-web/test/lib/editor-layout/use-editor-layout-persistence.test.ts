import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditorLayoutPersistence, DEFAULT_LAYOUT } from "@/lib/editor-layout/use-editor-layout-persistence";

describe("useEditorLayoutPersistence", () => {
  beforeEach(() => { localStorage.clear(); });

  it("returns DEFAULT_LAYOUT when nothing persisted", () => {
    const { result } = renderHook(() => useEditorLayoutPersistence("p-1"));
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  it("write + read roundtrip per projectId", () => {
    const { result } = renderHook(() => useEditorLayoutPersistence("p-1"));
    act(() => {
      result.current.setLayout({ leftWidthPct: 40, leftCollapsed: false, rightCollapsed: false });
    });
    const { result: r2 } = renderHook(() => useEditorLayoutPersistence("p-1"));
    expect(r2.current.layout.leftWidthPct).toBe(40);
  });

  it("clamps leftWidthPct to [15, 85]", () => {
    localStorage.setItem("atlas:editorLayout:p-2", JSON.stringify({ leftWidthPct: 5, leftCollapsed: false, rightCollapsed: false }));
    const { result } = renderHook(() => useEditorLayoutPersistence("p-2"));
    expect(result.current.layout.leftWidthPct).toBe(15);

    localStorage.setItem("atlas:editorLayout:p-3", JSON.stringify({ leftWidthPct: 99, leftCollapsed: false, rightCollapsed: false }));
    const { result: r3 } = renderHook(() => useEditorLayoutPersistence("p-3"));
    expect(r3.current.layout.leftWidthPct).toBe(85);
  });

  it("returns defaults when localStorage value is malformed JSON", () => {
    localStorage.setItem("atlas:editorLayout:p-4", "{not json}");
    const { result } = renderHook(() => useEditorLayoutPersistence("p-4"));
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });
});
