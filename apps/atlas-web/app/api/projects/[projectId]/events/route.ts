import { auth } from "@/lib/auth/clerk-compat";
import { getEventBroker } from "@/lib/events/broker-singleton";

export const dynamic = "force-dynamic";

const KEEPALIVE_INTERVAL_MS = 15_000;

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return new Response("unauthorized", { status: 401 });

  const { projectId } = await params;
  const sinceEventId = req.headers.get("Last-Event-ID") ?? undefined;

  const ac = new AbortController();
  // When the client disconnects (browser closes tab, navigates away), the
  // request signal aborts — we forward to our internal AbortController so
  // the broker subscription's iterator returns and the keepalive timer
  // is cleared. Without this the route would hold a subscriber forever.
  if (req.signal) {
    if (req.signal.aborted) ac.abort();
    else req.signal.addEventListener("abort", () => ac.abort(), { once: true });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const enqueue = (s: string) => {
        try { controller.enqueue(encoder.encode(s)); }
        catch { /* controller closed; subscription's signal will end the loop */ }
      };

      // Initial connect comment — most EventSource clients ignore comments
      // but it flushes the first chunk so the browser commits the response.
      enqueue(`: connected to project ${projectId}\n\n`);

      const keepalive = setInterval(() => {
        enqueue(`: keepalive\n\n`);
      }, KEEPALIVE_INTERVAL_MS);

      const broker = getEventBroker();
      const sub = broker.subscribe(projectId, { sinceEventId, signal: ac.signal });

      try {
        for await (const event of sub) {
          // SSE frame format: id line + data line (single JSON), terminated
          // by a blank line. Per HTML spec the browser will echo the most
          // recent id back as Last-Event-ID on auto-reconnect.
          enqueue(`id: ${event.id}\n`);
          enqueue(`data: ${JSON.stringify(event)}\n\n`);
          console.log(`[sse] ${projectId.slice(0, 8)} → ${event.type}`);
        }
      } catch (err) {
        // Defensive: never let an iterator throw escape the stream — log
        // and close the connection so the client reconnects.
        console.error("[sse-route] subscription error:", err);
      } finally {
        clearInterval(keepalive);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      ac.abort();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
