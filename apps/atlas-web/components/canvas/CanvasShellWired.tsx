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
  /** Forwarded into PreviewCanvas's rendererProps when canvas mode is "preview".
   *  Without this, the iframe has no src and the canvas looks empty even after
   *  the developer's diff applies. */
  sandboxId?: string;
  previewUrl?: string;
  previewError?: string;
  /** Plan UXO change 3 — gates the click-to-edit IframeOverlay inside
   *  PreviewCanvas. Threaded through unchanged; the overlay itself adds
   *  the mode === "visual-edits" check. */
  clickToEditEnabled?: boolean;
  /** Plan UXO Task 8 / change 6 — gates the ElementInspector side panel
   *  inside PreviewCanvas. Threaded through unchanged; the inspector
   *  itself adds the mode === "visual-edits" check. */
  elementSlidersEnabled?: boolean;
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
  sandboxId,
  previewUrl,
  previewError,
  clickToEditEnabled,
  elementSlidersEnabled,
  onSelectDirection,
  manifestOverride
}: CanvasShellWiredProps) {
  const { manifest: liveManifest } = useCanvasManifest(projectId);
  const proposalState = useDesignerProposal(projectId);

  const manifest = manifestOverride ?? liveManifest;
  const selectAction = onSelectDirection ?? selectDesignDirection;

  // Track optimistic submission so DesignerCanvas can render a "Generating
  // your site…" overlay the instant the user clicks. Without this the page
  // sits silent on the cards for 60-90s (architect → researcher → designer →
  // asset-gen → developer → sandbox apply) while the user wonders if the
  // click registered. Cleared automatically when CanvasShell auto-switches
  // away from the designing mode on sandbox.apply.completed, but we also
  // reset on ritualId change so a fresh ritual starts clean.
  const [submittedDirection, setSubmittedDirection] = React.useState<string | null>(null);
  const lastRitualRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (proposalState.ritualId !== lastRitualRef.current) {
      setSubmittedDirection(null);
      lastRitualRef.current = proposalState.ritualId;
    }
  }, [proposalState.ritualId]);

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
      setSubmittedDirection(directionId);
      void selectAction({
        ritualId: proposalState.ritualId,
        directionId,
        ...(chosen ? { tokens: chosen.tokens } : {})
      }).catch(() => {
        // Clear overlay on action error so the cards become clickable again.
        setSubmittedDirection(null);
      });
    },
    [proposalState, selectAction]
  );

  const handleRefine = React.useCallback((_directionId: string) => {
    // Plan S.4 ships select-only; refine wizard is a follow-up. Ignore
    // for now so the click is a no-op rather than a runtime crash.
  }, []);

  const rendererProps: Record<string, unknown> = React.useMemo(() => {
    // Preview-mode props go in every payload so PreviewCanvas can find them
    // whenever CanvasShell flips to that mode. DesignerCanvas ignores the
    // extra fields. Designer-mode props (proposal + callbacks) only land when
    // we have a live proposal to render.
    const previewProps: Record<string, unknown> = {
      projectId,
      ...(sandboxId !== undefined ? { sandboxId } : {}),
      ...(previewUrl !== undefined ? { previewUrl } : {}),
      ...(previewError !== undefined ? { previewError } : {}),
      ...(clickToEditEnabled !== undefined ? { clickToEditEnabled } : {}),
      ...(elementSlidersEnabled !== undefined ? { elementSlidersEnabled } : {})
    };
    if (proposalState.ritualId === null) {
      return { persona, ...previewProps };
    }
    return {
      proposal: proposalState.proposal,
      persona,
      onSelect: handleSelect,
      onRefine: handleRefine,
      ...(submittedDirection !== null ? { submittedDirectionId: submittedDirection } : {}),
      ...previewProps
    };
  }, [proposalState, persona, projectId, sandboxId, previewUrl, previewError, clickToEditEnabled, elementSlidersEnabled, handleSelect, handleRefine, submittedDirection]);

  return (
    <CanvasShell
      manifest={manifest}
      persona={persona}
      rendererProps={rendererProps}
    />
  );
}

export default CanvasShellWired;
