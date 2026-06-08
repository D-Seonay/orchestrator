import { NextRequest, NextResponse } from 'next/server';
import { orchestrator } from '@/lib/orchestrator';

type Params = { params: Promise<{ group: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { group } = await params;
  const groupName = decodeURIComponent(group);

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  switch (body.action) {
    case 'start':   orchestrator.startGroup(groupName);   break;
    case 'stop':    orchestrator.stopGroup(groupName);    break;
    case 'restart': orchestrator.restartGroup(groupName); break;
    default: return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
