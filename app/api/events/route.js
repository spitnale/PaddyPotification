import { list, subscribe, unsubscribe } from '../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-Sent Events stream: pushes the full session list to every open dashboard.
export async function GET(req) {
  const enc = new TextEncoder();
  let listener;
  let heartbeat;

  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          /* stream closed */
        }
      };

      // Initial state on connect.
      write(`event: snapshot\ndata: ${JSON.stringify(list())}\n\n`);

      // Push on every change.
      listener = (data) => write(`event: update\ndata: ${JSON.stringify(data)}\n\n`);
      subscribe(listener);

      // Keep the connection alive through proxies / phone sleep.
      heartbeat = setInterval(() => write(`: ping\n\n`), 15000);

      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubscribe(listener);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe(listener);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
