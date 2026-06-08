import { NextRequest, NextResponse } from 'next/server';
import { orchestrator } from '@/lib/orchestrator';
import fs from 'fs';
import path from 'path';

export async function GET() {
  return NextResponse.json(orchestrator.getAppsConfig());
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.name || !body.script) {
    return NextResponse.json({ error: 'Missing name or script' }, { status: 400 });
  }

  const name = body.name as string;
  const script = body.script as string;
  const cwd = body.cwd as string | undefined;

  if (orchestrator.getAppsConfig().find(a => a.name === name)) {
    return NextResponse.json({ error: 'App already exists' }, { status: 400 });
  }

  if (cwd && !fs.existsSync(cwd)) {
    return NextResponse.json({ error: 'CWD path does not exist' }, { status: 400 });
  }

  const checkCwd = cwd || process.cwd();
  if (!fs.existsSync(path.resolve(checkCwd, script))) {
    return NextResponse.json({ error: 'Script path does not exist' }, { status: 400 });
  }

  orchestrator.add(body as Parameters<typeof orchestrator.add>[0]);
  return NextResponse.json({ success: true }, { status: 201 });
}
