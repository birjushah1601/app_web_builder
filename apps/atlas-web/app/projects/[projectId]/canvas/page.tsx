import { CanvasClient } from "@/components/CanvasClient";
import { ChatPanel } from "@/components/ChatPanel";
import { startRitual } from "@/lib/actions/startRitual";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { CanvasPreviewClient } from "./_components/CanvasPreviewClient";

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

  return (
    <main className="flex h-full">
      <section className="flex-1 flex flex-col">
        <CanvasPreviewClient
          projectId={projectId}
          sandboxId={sandboxId}
          previewUrl={previewUrl}
          previewError={previewError}
        />
        <CanvasClient graph={graph} projectId={projectId} />
      </section>
      {liveEventsOn ? null : <ChatPanel projectId={projectId} action={startRitual} />}
    </main>
  );
}
