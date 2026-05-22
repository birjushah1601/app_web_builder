import { ChatPanelWithSelectionChip } from "@/components/canvas/ChatPanelWithSelectionChip";
import { DemoModeToggle } from "@/components/DemoModeToggle";
import { startRitual } from "@/lib/actions/startRitual";
import { refineRitual } from "@/lib/actions/refineRitual";
import { getLatestRitualForProject } from "@/lib/actions/getLatestRitualForProject";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { isFeatureEnabledForRequest } from "@/lib/feature-flags-server";
import { CanvasPreviewClient } from "./_components/CanvasPreviewClient";
import { CanvasShellWired } from "@/components/canvas/CanvasShellWired";
import { ModeToolbarHost } from "@/components/canvas/ModeToolbarHost";
import { RedeployButton } from "@/components/canvas/RedeployButton";
import { BuildProgressBanner } from "@/components/canvas/BuildProgressBanner";
// Side-effect import — populates the canvasModeRegistry singleton at module
// load time (atlas-web only mounts CanvasShell when the canvas-v1 flag is on,
// but the registration runs unconditionally so the registry is always ready).
import "@/components/canvas/register-renderers";

export default async function CanvasPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  // E.4: Lazy-provision sandbox and get preview URL for the HMR iframe.
  let previewUrl: string | undefined;
  let sandboxId = "";
  let previewError: string | undefined;
  try {
    const session = await getSandboxFactory().getOrProvision(projectId);
    previewUrl = session.previewUrl;
    sandboxId = session.record.sandboxId;
  } catch (err) {
    // Sandbox provision failed (spend cap, missing API key, etc.) — degrade
    // gracefully and surface the reason to the client so users don't stare
    // at a forever-loading skeleton.
    previewUrl = undefined;
    previewError = err instanceof Error ? err.message : String(err);
  }

  // Plan G: when live-events is on, [projectId]/layout.tsx mounts a
  // persistent <RailShell /> that owns the ChatPanel. Mounting a second
  // ChatPanel here would double-render the chat history and split the
  // conversation across two trees — gate the local mount on the flag.
  const liveEventsOn = isFeatureEnabled("live-events");
  const multiTurnOn = isFeatureEnabled("multi-turn");
  // Plan UXO Task 6 — pass through to ChatPanel when live-events is OFF.
  const referenceInputOn = isFeatureEnabled("reference-input");
  // Plan U — pass through to ChatPanel when live-events is OFF.
  const structuredTriageOn = isFeatureEnabled("structured-triage");
  // Refine-by-default — when multi-turn is on, look up the most recent
  // ritual for this project so ChatPanel auto-routes the next submit
  // through refineAction. Failure-safe: returns null if DB unreachable
  // OR no rituals exist yet → ChatPanel falls back to cold-start.
  const latestRitual = multiTurnOn
    ? await getLatestRitualForProject(projectId)
    : null;
  // Plan S.4: when canvas-v1 is on, replace the preview-only right pane
  // with the polymorphic <CanvasShell>. No manifest is wired in this commit
  // (the engine-integration plan ships the manifest source); CanvasShell
  // renders <EmptyCanvas> until the manifest arrives. Flag-OFF preserves
  // today's preview-only tree byte-for-byte.
  const canvasV1On = isFeatureEnabled("canvas-v1");
  // Plan UXO change 2 — three-mode (Agent/Plan/Visual-Edits) toolbar.
  // Visible only inside the canvas-v1 branch (the bare CanvasPreviewClient
  // branch is preview-only — no mode-switch surface to host). Downstream
  // consumers (Visual-Edits panel, Plan UI) wire in later UXO slices.
  const modeToolbarOn = isFeatureEnabled("mode-toolbar");
  // Plan UXO change 3 — click-to-edit overlay on the preview iframe.
  // Resolved here (server) and threaded into both the direct
  // CanvasPreviewClient mount and the CanvasShellWired → PreviewCanvas
  // path so the client component never needs to read process.env. The
  // overlay only mounts when this flag is on AND useCanvasMode === "visual-edits".
  const clickToEditOn = isFeatureEnabled("click-to-edit");
  // Plan UXO Task 8 / change 6 — per-element Haiku-proposed slider
  // inspector. Same dual gate as click-to-edit (flag + visual-edits mode);
  // resolved on the server so CanvasPreviewClient stays env-free.
  const elementSlidersOn = isFeatureEnabled("element-sliders");
  // Plan canvas-in-place-editing Task 17 — inline text/image editing overlay.
  // Resolved server-side so CanvasPreviewClient stays env-free.
  const inlineEditOn = isFeatureEnabled("inline-edit-v1");
  // Plan Q.UI — pass the per-request demo-mode state (env OR cookie) to
  // the toggle so its checkbox renders in the correct initial position
  // on first paint.
  const demoModeOn = await isFeatureEnabledForRequest("demo-mode");

  return (
    <main className="flex h-full flex-col">
      <header
        data-testid="canvas-header"
        className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-1"
      >
        {modeToolbarOn && canvasV1On && (
          <div className="flex-1 min-w-0">
            <ModeToolbarHost projectId={projectId} />
          </div>
        )}
        <div className="flex items-center gap-3 ml-auto">
          <RedeployButton projectId={projectId} />
          <DemoModeToggle projectId={projectId} initialEnabled={demoModeOn} />
        </div>
      </header>
      <BuildProgressBanner />
      <div className="flex flex-1 min-h-0">
      <section className="flex-1 flex flex-col">
        {canvasV1On ? (
          <>
            <CanvasShellWired
              projectId={projectId}
              persona="ama"
              {...(sandboxId ? { sandboxId } : {})}
              {...(previewUrl !== undefined ? { previewUrl } : {})}
              {...(previewError !== undefined ? { previewError } : {})}
              clickToEditEnabled={clickToEditOn}
              elementSlidersEnabled={elementSlidersOn}
              inlineEditEnabled={inlineEditOn}
            />
          </>
        ) : (
          <CanvasPreviewClient
            projectId={projectId}
            sandboxId={sandboxId}
            previewUrl={previewUrl}
            previewError={previewError}
            clickToEditEnabled={clickToEditOn}
            elementSlidersEnabled={elementSlidersOn}
            inlineEditEnabled={inlineEditOn}
          />
        )}
      </section>
      {liveEventsOn ? null : (
        <ChatPanelWithSelectionChip
          projectId={projectId}
          action={startRitual}
          multiTurnFlagEnabled={multiTurnOn}
          refineAction={refineRitual}
          referenceInputEnabled={referenceInputOn}
          structuredTriageEnabled={structuredTriageOn}
          {...(latestRitual ? { initialLatestRitualId: latestRitual.ritualId } : {})}
        />
      )}
      </div>
    </main>
  );
}
