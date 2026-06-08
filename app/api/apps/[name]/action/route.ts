import { NextRequest, NextResponse } from 'next/server';
import { orchestrator } from '@/lib/orchestrator';

type Params = { params: Promise<{ name: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const appName = decodeURIComponent(name);

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  switch (body.action) {
    case 'start':
      orchestrator.start(appName);
      break;
    case 'stop':
      orchestrator.stop(appName);
      break;
    case 'restart':
      orchestrator.restart(appName);
      break;
    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
