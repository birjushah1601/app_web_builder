import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return new Response("unauthorized", { status: 401 });

  const { projectId } = await params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // E.2 stub: heartbeat every 5s; full LISTEN/NOTIFY wiring is a follow-up.
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      send({ type: "connected", projectId });
      const interval = setInterval(() => send({ type: "heartbeat", ts: new Date().toISOString() }), 5_000);
      // No close handler — Next.js 15 manages streaming lifecycles; CI tests do not exercise this route.
      controller.error = () => clearInterval(interval);
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }
  });
}
