"use client";
/**
 * PreviewCanvas — preview-mode renderer for the canvas shell.
 *
 * Re-exports the existing CanvasPreviewClient under a name the
 * CanvasModeRegistry can register against. Production-shaped seam: today's
 * preview-only canvas behavior is preserved verbatim, S.4 just gives it a
 * registry-friendly handle so polymorphic mode lookup works.
 */
export { CanvasPreviewClient as PreviewCanvas } from "@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient";
export { CanvasPreviewClient as default } from "@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient";
