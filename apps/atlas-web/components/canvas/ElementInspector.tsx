"use client";
/**
 * Plan UXO Task 8 — per-element generated sliders (Change 6).
 *
 * Reads the currently-selected DomNode (lifted by the canvas page so the
 * IframeOverlay and this inspector share one selection — `useElementSelection`
 * is per-consumer, so two consumers each get their own state). On every
 * selection change, asks Haiku via `proposeElementAxes` for 2-5 adjustable
 * axes and renders one <input type="range"> per axis. Each slider change
 * fires `applyElementAxisChange` which patches design-tokens.json in the
 * sandbox (Tailwind HMR re-renders the preview).
 *
 * Mounted by the canvas page only when:
 *   - the `element-sliders` (ATLAS_FF_ELEMENT_SLIDERS) flag is on, AND
 *   - useCanvasMode === "visual-edits".
 *
 * Props:
 *   - projectId — forwarded to applyElementAxisChange so the action knows
 *                 which sandbox to write design-tokens.json in.
 *   - selected  — the currently-clicked element, or null when nothing is
 *                 selected (we render the "click an element" hint instead
 *                 of calling Haiku for a no-op).
 *   - proposeAxes / applyChange — test seams. Default to the real server
 *                 actions; unit tests pass mocks so they don't need a
 *                 live LLM or sandbox.
 */
import * as React from "react";
import {
  proposeElementAxes as defaultProposeAxes,
  type ElementAxis,
  type ElementContext
} from "@/lib/actions/proposeElementAxes";
import {
  applyElementAxisChange as defaultApplyChange,
  type ApplyElementAxisChangeInput
} from "@/lib/actions/applyElementAxisChange";
import type { DomNode } from "@/lib/canvas/use-element-selection";

export interface ElementInspectorProps {
  projectId: string;
  selected: DomNode | null;
  /** Test seam — defaults to the real Server Action import. */
  proposeAxes?: (ctx: ElementContext) => Promise<ElementAxis[]>;
  /** Test seam — defaults to the real Server Action import. */
  applyChange?: (input: ApplyElementAxisChangeInput) => Promise<void>;
}

export function ElementInspector({
  projectId,
  selected,
  proposeAxes,
  applyChange
}: ElementInspectorProps) {
  const propose = proposeAxes ?? defaultProposeAxes;
  const apply = applyChange ?? defaultApplyChange;

  const [axes, setAxes] = React.useState<ElementAxis[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!selected) {
      setAxes([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    propose({ tag: selected.tag, classes: selected.classes, text: selected.text })
      .then((result) => {
        if (!cancelled) setAxes(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, propose]);

  if (!selected) {
    return (
      <div data-testid="element-inspector-empty" className="p-4 text-xs text-slate-500">
        Click an element in the preview to edit it.
      </div>
    );
  }
  return (
    <div data-testid="element-inspector" className="p-4 space-y-3">
      <div className="text-xs font-mono">
        {selected.tag} · {selected.classes.slice(0, 2).join(" ")}
      </div>
      {loading && (
        <div data-testid="element-inspector-loading" className="text-xs text-slate-500">
          Proposing axes…
        </div>
      )}
      {axes.map((a) => (
        <div key={a.name} data-testid="element-inspector-axis" data-axis-name={a.name}>
          <div className="text-xs font-medium">{a.label}</div>
          <input
            type="range"
            min={a.min}
            max={a.max}
            step={a.step}
            defaultValue={a.currentValue}
            onChange={(e) => {
              void apply({
                projectId,
                selector: selected.selector,
                axis: {
                  ...(a.tokenKey !== undefined ? { tokenKey: a.tokenKey } : {}),
                  ...(a.cssProperty !== undefined ? { cssProperty: a.cssProperty } : {})
                },
                value: `${e.target.value}${a.unit}`
              });
            }}
          />
        </div>
      ))}
    </div>
  );
}
