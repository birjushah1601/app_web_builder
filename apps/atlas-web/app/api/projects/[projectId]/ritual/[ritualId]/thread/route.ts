import { auth } from "@/lib/auth/clerk-compat";
import { getRitualEngine } from "@/lib/engine/factory";

const MAX_DEPTH = 50;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; ritualId: string }> }
) {
  const { projectId, ritualId } = await params;
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const engine = await getRitualEngine(projectId);
  const leaf = await engine.getRitual(ritualId);
  if (!leaf) return Response.json({ error: "ritual not found" }, { status: 404 });
  if (leaf.projectId !== projectId) {
    return Response.json({ error: "project mismatch" }, { status: 403 });
  }

  // Walk parent chain root-ward, then reverse so caller gets root → leaf.
  const reverseChain: typeof leaf[] = [leaf];
  let cursor = leaf;
  for (let depth = 0; depth < MAX_DEPTH && cursor.parentRitualId; depth++) {
    const parent = await engine.getRitual(cursor.parentRitualId);
    if (!parent) break;
    reverseChain.push(parent);
    cursor = parent;
  }

  return Response.json({ thread: reverseChain.reverse() });
}
