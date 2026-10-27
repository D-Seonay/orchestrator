import type { NextRequest } from 'next/server';
import { orchestrator } from '@/lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let interval: NodeJS.Timeout | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(orchestrator.dashboard())}\n\n`));
      };
      const stop = () => {
        clearInterval(interval);
        try { controller.close(); } catch { /* déjà fermé */ }
      };

      send();
      interval = setInterval(() => {
        try { send(); } catch { stop(); }
      }, 2000);
      req.signal.addEventListener('abort', stop);
    },
    cancel() {
      clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
