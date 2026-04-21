import { CanvasClient } from "@/components/CanvasClient";
import { ChatPanel } from "@/components/ChatPanel";
import { startRitual } from "@/lib/actions/startRitual";

export default async function CanvasPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  // E.2 ships an empty-graph fallback. A future task wires SpecGraphRepo.read(projectId).
  const graph = { nodes: {}, edges: [] };

  return (
    <main className="flex h-full">
      <section className="flex-1">
        <CanvasClient graph={graph} projectId={projectId} />
      </section>
      <ChatPanel
        projectId={projectId}
        onSend={async (userTurn) => startRitual({ projectId, userTurn, editClass: "structural" })}
      />
    </main>
  );
}
