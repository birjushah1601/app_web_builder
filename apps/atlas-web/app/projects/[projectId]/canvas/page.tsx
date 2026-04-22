import { CanvasClient } from "@/components/CanvasClient";
import { ChatPanel } from "@/components/ChatPanel";
import { startRitual } from "@/lib/actions/startRitual";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { CanvasPreviewClient } from "./_components/CanvasPreviewClient";

export default async function CanvasPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  // E.2 ships an empty-graph fallback. A future task wires SpecGraphRepo.read(projectId).
  const graph = { nodes: {}, edges: [] };

  // E.4: Lazy-provision sandbox and get preview URL for the HMR iframe.
  let previewUrl: string | undefined;
  let sandboxId = "";
  try {
    const session = await getSandboxFactory().getOrProvision(projectId);
    previewUrl = session.previewUrl;
    sandboxId = session.record.sandboxId;
  } catch {
    // Sandbox provision failed (spend cap, missing API key, etc.) — degrade gracefully.
    previewUrl = undefined;
  }

  return (
    <main className="flex h-full">
      <section className="flex-1 flex flex-col">
        <CanvasPreviewClient
          projectId={projectId}
          sandboxId={sandboxId}
          previewUrl={previewUrl}
        />
        <CanvasClient graph={graph} projectId={projectId} />
      </section>
      <ChatPanel projectId={projectId} action={startRitual} />
    </main>
  );
}
