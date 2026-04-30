"use client";

import { useCallback, useEffect, useState } from "react";

export interface EditorLayout {
  /** 15..85, percentage of horizontal space taken by the chat zone. */
  leftWidthPct: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export const DEFAULT_LAYOUT: EditorLayout = Object.freeze({
  leftWidthPct: 35,
  leftCollapsed: false,
  rightCollapsed: false
});

const KEY_PREFIX = "atlas:editorLayout:";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function readPersisted(projectId: string): EditorLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + projectId);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<EditorLayout>;
    return {
      leftWidthPct: clamp(Number(parsed.leftWidthPct ?? DEFAULT_LAYOUT.leftWidthPct), 15, 85),
      leftCollapsed: Boolean(parsed.leftCollapsed ?? false),
      rightCollapsed: Boolean(parsed.rightCollapsed ?? false)
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function useEditorLayoutPersistence(projectId: string) {
  // SSR-safe initial state — server renders defaults, client hydrates real value.
  const [layout, setLayoutState] = useState<EditorLayout>(DEFAULT_LAYOUT);

  // Hydrate from localStorage after mount.
  useEffect(() => {
    setLayoutState(readPersisted(projectId));
  }, [projectId]);

  const setLayout = useCallback(
    (next: EditorLayout) => {
      const sanitized: EditorLayout = {
        leftWidthPct: clamp(next.leftWidthPct, 15, 85),
        leftCollapsed: Boolean(next.leftCollapsed),
        rightCollapsed: Boolean(next.rightCollapsed)
      };
      setLayoutState(sanitized);
      try {
        window.localStorage.setItem(KEY_PREFIX + projectId, JSON.stringify(sanitized));
      } catch {
        /* localStorage full / disabled — drop persistence; runtime state still valid */
      }
    },
    [projectId]
  );

  return { layout, setLayout };
}
