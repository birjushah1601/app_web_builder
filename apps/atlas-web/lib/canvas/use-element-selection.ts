"use client";
/**
 * Plan UXO change 3 — click-to-edit selection state.
 *
 * Listens to the sandbox edit bridge (packages/sandbox-e2b/templates/
 * atlas-next-ts/src/atlas-edit-bridge.ts) via window.postMessage. Each
 * "atlas-dom-tree" message replaces the local node list; the hook also
 * tracks which node is currently selected by the user.
 *
 * Owned by <IframeOverlay /> in the canvas preview pane, behind the
 * `click-to-edit` (ATLAS_FF_CLICK_TO_EDIT) feature flag.
 */
import * as React from "react";

export interface DomNode {
  selector: string;
  atlasId: string;
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  classes: string[];
}

export interface UseElementSelectionResult {
  nodes: DomNode[];
  selected: DomNode | null;
  setSelected: (n: DomNode | null) => void;
}

export function useElementSelection(): UseElementSelectionResult {
  const [nodes, setNodes] = React.useState<DomNode[]>([]);
  const [selected, setSelected] = React.useState<DomNode | null>(null);
  React.useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const data = ev.data as { type?: string; nodes?: DomNode[] } | null | undefined;
      if (data && data.type === "atlas-dom-tree") {
        setNodes(Array.isArray(data.nodes) ? data.nodes : []);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return { nodes, selected, setSelected };
}
