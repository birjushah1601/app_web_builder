"use client";
import * as React from "react";
import type { DomMutationOp } from "@atlas/edit-patch-engine";

export interface ElementContextMenuProps {
  x: number;
  y: number;
  onAction: (op: DomMutationOp) => void;
  onClose: () => void;
}

export function ElementContextMenu({ x, y, onAction, onClose }: ElementContextMenuProps) {
  React.useEffect(() => {
    const closeOnOutside = () => onClose();
    window.addEventListener("click", closeOnOutside);
    return () => window.removeEventListener("click", closeOnOutside);
  }, [onClose]);

  return (
    <div
      role="menu"
      className="absolute z-50 min-w-[10rem] rounded-md border border-slate-300 bg-white py-1 text-xs shadow-md"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <button role="menuitem" onClick={() => onAction({ kind: "delete" })} className="block w-full px-3 py-1 text-left hover:bg-slate-100">Delete</button>
      <button role="menuitem" onClick={() => onAction({ kind: "duplicate" })} className="block w-full px-3 py-1 text-left hover:bg-slate-100">Duplicate</button>
      <button role="menuitem" onClick={() => onAction({ kind: "wrap", wrapperTag: "section" })} className="block w-full px-3 py-1 text-left hover:bg-slate-100">Wrap in section</button>
      <button role="menuitem" onClick={() => onAction({ kind: "reorder", direction: "up" })} className="block w-full px-3 py-1 text-left hover:bg-slate-100">Move up</button>
      <button role="menuitem" onClick={() => onAction({ kind: "reorder", direction: "down" })} className="block w-full px-3 py-1 text-left hover:bg-slate-100">Move down</button>
    </div>
  );
}
