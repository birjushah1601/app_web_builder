"use client";
/**
 * CanvasShellWired — client wrapper that pulls the live manifest +
 * designer proposal off the SSE stream and feeds them into <CanvasShell>.
 *
 * Lives in components/canvas (alongside CanvasShell) because the page is
 * a Server Component and can't call hooks. The page mounts this wrapper
 * in place of the bare <CanvasShell manifest={undefined} />.
 *
 * Wiring rules:
 *   - manifest comes from useCanvasManifest (architect.canvas_manifest.emitted)
 *   - proposal + ritualId come from useDesignerProposal (canvas.options.requested)
 *   - rendererProps['designing'] = { proposal, persona, onSelect, onRefine }
 *     so DesignerCanvas (the registered "designing" renderer) gets exactly
 *     the props it expects.
 *   - when no proposal is in flight rendererProps stays empty — the canvas
 *     auto-switches off "designing" via useCanvasState anyway.
 */
import * as React from "react";
import type { CanvasManifest } from "@atlas/canvas-runtime";
import type { PersonaTier } from "@atlas/ritual-engine";
import { CanvasShell } from "./CanvasShell";
import { useCanvasManifest } from "@/lib/canvas/useCanvasManifest";
import { useDesignerProposal } from "@/lib/canvas/useDesignerProposal";
import { selectDesignDirection } from "@/lib/actions/selectDesignDirection";

export interface CanvasShellWiredProps {
  projectId: string;
  persona: PersonaTier;
  /** Test seam — defaults to the Server Action import. Tests can pass a
   *  vitest mock fn here so they don't need to mock the action module. */
  onSelectDirection?: (input: { ritualId: string; directionId: string; tokens?: unknown }) => Promise<void>;
  /** Test seam — overrides the manifest hook for stories / unit tests
   *  that don't want to mount the SSE provider. */
  manifestOverride?: CanvasManifest | undefined;
}

export function CanvasShellWired({
  projectId,
  persona,
  onSelectDirection,
  manifestOverride
}: CanvasShellWiredProps) {
  const { manifest: liveManifest } = useCanvasManifest(projectId);
  const proposalState = useDesignerProposal(projectId);

  const manifest = manifestOverride ?? liveManifest;
  const selectAction = onSelectDirection ?? selectDesignDirection;

  const handleSelect = React.useCallback(
    (directionId: string) => {
      if (proposalState.ritualId === null) return;
      // Look up the direction's tokens from the live proposal so we forward
      // them into the engine — without tokens the developer would see an
      // unstyled selection. Best-effort: if the directionId doesn't match,
      // fall back to undefined and let the engine use the recommended fallback.
      const all = [
        proposalState.proposal.recommended,
        ...proposalState.proposal.alternates
      ];
      const chosen = all.find((d) => d.id === directionId);
      void selectAction({
        ritualId: proposalState.ritualId,
        directionId,
        ...(chosen ? { tokens: chosen.tokens } : {})
      });
    },
    [proposalState, selectAction]
  );

  const handleRefine = React.useCallback((_directionId: string) => {
    // Plan S.4 ships select-only; refine wizard is a follow-up. Ignore
    // for now so the click is a no-op rather than a runtime crash.
  }, []);

  const rendererProps: Record<string, unknown> = React.useMemo(() => {
    if (proposalState.ritualId === null) {
      return { persona };
    }
    return {
      proposal: proposalState.proposal,
      persona,
      onSelect: handleSelect,
      onRefine: handleRefine
    };
  }, [proposalState, persona, handleSelect, handleRefine]);

  return (
    <CanvasShell
      manifest={manifest}
      persona={persona}
      rendererProps={rendererProps}
    />
  );
}

export default CanvasShellWired;
