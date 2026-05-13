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
  redo: () => Promise<PatchResult | null>;
  canUndo: boolean;
  canRedo: boolean;
}

/** Client-side serial patch queue + undo/redo stack. Patches submit one at a
 *  time (server-side already coalesces but the client enforces order so the
 *  optimistic UI stays consistent). Successful patches push their inverse
 *  onto the undo stack; failed patches are dropped.
 *
 *  Redo: when undo() is called, the reverted patch (inverse-of-inverse = original)
 *  is pushed onto a redo stack. A new submitPatch resets the redo stack. */
export function useEditPatchQueue(opts: { apply: Applier }): UseEditPatchQueueResult {
  const [undoStack, setUndoStack] = React.useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = React.useState<UndoEntry[]>([]);
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
        // A new patch invalidates the redo history.
        setRedoStack([]);
      }
      return result;
    },
    [opts]
  );

  const undo = React.useCallback(async (): Promise<PatchResult | null> => {
    if (undoStack.length === 0) return null;
    const last = undoStack[undoStack.length - 1]!;
    setUndoStack((s) => s.slice(0, -1));
    const result = await opts.apply({ filePath: last.filePath, patch: last.inverse });
    // The result's inverse is the inverse-of-the-inverse = the original patch.
    // Push it onto the redo stack so redo() can re-apply it.
    if (result.ok && result.inverse) {
      setRedoStack((s) => [...s, { filePath: last.filePath, inverse: result.inverse! }]);
    }
    return result;
  }, [undoStack, opts]);

  const redo = React.useCallback(async (): Promise<PatchResult | null> => {
    if (redoStack.length === 0) return null;
    const last = redoStack[redoStack.length - 1]!;
    setRedoStack((s) => s.slice(0, -1));
    const result = await opts.apply({ filePath: last.filePath, patch: last.inverse });
    // Push the inverse back onto the undo stack (same as submitPatch's path)
    // but do NOT reset the redo stack.
    if (result.ok && result.inverse) {
      setUndoStack((s) => [...s, { filePath: last.filePath, inverse: result.inverse! }]);
    }
    return result;
  }, [redoStack, opts]);

  return {
    submitPatch,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0
  };
}
