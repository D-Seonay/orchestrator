import { NextRequest } from 'next/server';
import { orchestrator } from '@/lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        const payload = JSON.stringify({
          apps: orchestrator.getStats(),
          masterUptime: orchestrator.getMasterUptime(),
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      send();
      const interval = setInterval(send, 2000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
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
