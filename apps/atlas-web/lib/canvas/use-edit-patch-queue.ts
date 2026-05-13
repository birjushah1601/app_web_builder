"use client";
import * as React from "react";
import type { EditPatch } from "@atlas/edit-patch-engine";

export interface PatchRequest {
  filePath: string;
  patch: EditPatch;
}

export interface PatchResult {
  ok: boolean;
  inverse?: EditPatch;
  error?: string;
}

/** Caller-supplied applier. Almost always the applyPatch Server Action, but
 *  the seam lets unit tests stub it without mocking the action module. */
type Applier = (req: PatchRequest) => Promise<PatchResult>;

interface UndoEntry {
  filePath: string;
  inverse: EditPatch;
}

export interface UseEditPatchQueueResult {
  submitPatch: (req: PatchRequest) => Promise<PatchResult>;
  undo: () => Promise<PatchResult | null>;
  canUndo: boolean;
}

/** Client-side serial patch queue + undo stack. Patches submit one at a
 *  time (server-side already coalesces but the client enforces order so the
 *  optimistic UI stays consistent). Successful patches push their inverse
 *  onto the undo stack; failed patches are dropped. */
export function useEditPatchQueue(opts: { apply: Applier }): UseEditPatchQueueResult {
  const [undoStack, setUndoStack] = React.useState<UndoEntry[]>([]);
  const inflightRef = React.useRef<Promise<unknown>>(Promise.resolve());

  const submitPatch = React.useCallback(
    async (req: PatchRequest): Promise<PatchResult> => {
      // Chain onto inflight so calls serialize.
      const prior = inflightRef.current;
      const next = prior.then(() => opts.apply(req));
      inflightRef.current = next.catch(() => undefined);
      const result = await next;
      if (result.ok && result.inverse) {
        setUndoStack((s) => [...s, { filePath: req.filePath, inverse: result.inverse! }]);
      }
      return result;
    },
    [opts]
  );

  const undo = React.useCallback(async (): Promise<PatchResult | null> => {
    if (undoStack.length === 0) return null;
    const last = undoStack[undoStack.length - 1]!;
    setUndoStack((s) => s.slice(0, -1));
    return opts.apply({ filePath: last.filePath, patch: last.inverse });
  }, [undoStack, opts]);

  return { submitPatch, undo, canUndo: undoStack.length > 0 };
}
