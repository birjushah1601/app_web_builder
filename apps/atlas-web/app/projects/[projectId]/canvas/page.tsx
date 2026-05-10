import { CanvasClient } from "@/components/CanvasClient";
import { ChatPanel } from "@/components/ChatPanel";
import { startRitual } from "@/lib/actions/startRitual";
import { refineRitual } from "@/lib/actions/refineRitual";
import { getLatestRitualForProject } from "@/lib/actions/getLatestRitualForProject";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { CanvasPreviewClient } from "./_components/CanvasPreviewClient";
import { CanvasShell } from "@/components/canvas/CanvasShell";
// Side-effect import — populates the canvasModeRegistry singleton at module
// load time (atlas-web only mounts CanvasShell when the canvas-v1 flag is on,
// but the registration runs unconditionally so the registry is always ready).
import "@/components/canvas/register-renderers";

export default async function CanvasPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  // E.2 ships an empty-graph fallback. A future task wires SpecGraphRepo.read(projectId).
  const graph = { nodes: {}, edges: [] };

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

  return (
    <main className="flex h-full">
      <section className="flex-1 flex flex-col">
        {canvasV1On ? (
          <CanvasShell manifest={undefined} persona="ama" />
        ) : (
          <CanvasPreviewClient
            projectId={projectId}
            sandboxId={sandboxId}
            previewUrl={previewUrl}
            previewError={previewError}
          />
        )}
        <CanvasClient graph={graph} projectId={projectId} />
      </section>
      {liveEventsOn ? null : (
        <ChatPanel
          projectId={projectId}
          action={startRitual}
          multiTurnFlagEnabled={multiTurnOn}
          refineAction={refineRitual}
          {...(latestRitual ? { initialLatestRitualId: latestRitual.ritualId } : {})}
        />
      )}
    </main>
  );
}
