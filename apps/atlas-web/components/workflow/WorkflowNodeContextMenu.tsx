"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { WorkflowNode } from "@atlas/workflow-engine";
import { retryNode } from "@/lib/actions/retryNode";
import { setNodePolicy } from "@/lib/actions/setNodePolicy";
import { deferNode } from "@/lib/actions/deferNode";
import { resumeDeferredNode } from "@/lib/actions/resumeDeferredNode";

export interface WorkflowNodeContextMenuProps {
  projectId: string;
  workflowRunId: string;
  nodeId: string;
  /** The WorkflowNode object (for status + policy rendering decisions). */
  node: WorkflowNode;
  /** The HTMLElement the ⋯ button was clicked on; used to position the menu. */
  anchor: HTMLElement;
  onClose: () => void;
}

/**
 * Floating context menu anchored to the clicked ⋯ button's bounding rect.
 * Rendered as a portal-like absolutely-positioned div within the
 * workflow-graph container. Closes on click-outside or Escape.
 */
export function WorkflowNodeContextMenu({
  projectId,
  workflowRunId,
  nodeId,
  node,
  anchor,
  onClose
}: WorkflowNodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the menu relative to the anchor element
  const rect = anchor.getBoundingClientRect();
  // We render inside a position:relative wrapper (workflow-graph div),
  // so we need to subtract the parent's rect offset.
  const parentRect = anchor.closest("[data-testid='workflow-graph']")?.getBoundingClientRect();
  const top = rect.bottom - (parentRect?.top ?? 0) + 4;
  const left = rect.left - (parentRect?.left ?? 0);

  // Close on click outside
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const isBackground = node.policy.runMode === "background";
  const isDeferred = node.policy.runMode === "deferred";

  async function handleRetry() {
    await retryNode({ projectId, workflowRunId, nodeId });
    onClose();
  }

  async function handlePrioritize() {
    await setNodePolicy({ projectId, workflowRunId, nodeId, policy: { priority: 100 } });
    onClose();
  }

  async function handleToggleBackground() {
    await setNodePolicy({
      projectId,
      workflowRunId,
      nodeId,
      policy: { runMode: isBackground ? "active" : "background" }
    });
    onClose();
  }

  async function handleDefer() {
    await deferNode({ projectId, workflowRunId, nodeId });
    onClose();
  }

  async function handleResume() {
    await resumeDeferredNode({ projectId, workflowRunId, nodeId });
    onClose();
  }

  const drillInHref = `/projects/${projectId}/workflow/${workflowRunId}/node/${nodeId}`;

  return (
    <div
      ref={menuRef}
      data-testid="workflow-node-context-menu"
      style={{ top, left }}
      className="absolute z-50 min-w-[200px] rounded-md border border-slate-200 bg-white py-1 shadow-lg text-sm"
      role="menu"
    >
      {/* Open ritual logs — always visible */}
      <Link
        href={drillInHref}
        onClick={onClose}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
        role="menuitem"
      >
        Open ritual logs
      </Link>

      <div className="my-1 border-t border-slate-100" />

      {/* Retry — only when failed */}
      {node.status === "failed" && (
        <button
          type="button"
          onClick={handleRetry}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
          role="menuitem"
        >
          Retry node
        </button>
      )}

      {/* Prioritize */}
      <button
        type="button"
        onClick={handlePrioritize}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
        role="menuitem"
      >
        Prioritize
      </button>

      {/* Run in background / Active toggle */}
      <button
        type="button"
        onClick={handleToggleBackground}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
        role="menuitem"
      >
        {isBackground ? "Switch to Active" : "Run in background"}
      </button>

      {/* Defer / Resume */}
      {isDeferred ? (
        <button
          type="button"
          onClick={handleResume}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
          role="menuitem"
        >
          Resume from deferred
        </button>
      ) : (
        <button
          type="button"
          onClick={handleDefer}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
          role="menuitem"
        >
          Defer
        </button>
      )}

      <div className="my-1 border-t border-slate-100" />

      {/* Skip permanently — Plan G stub */}
      <button
        type="button"
        disabled
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-400 cursor-not-allowed"
        role="menuitem"
        aria-disabled="true"
        title="Coming in Plan G"
      >
        Skip permanently
        <span className="ml-auto text-[10px] text-slate-400">(Plan G)</span>
      </button>
    </div>
  );
}
