import { NextRequest, NextResponse } from 'next/server';
import { orchestrator } from '@/lib/orchestrator';
import fs from 'fs';

type Params = { params: Promise<{ name: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const appName = decodeURIComponent(name);

  if (!orchestrator.getAppsConfig().find(a => a.name === appName)) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 });
  }

  let updates: Record<string, unknown>;
  try {
    updates = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (updates.name && updates.name !== appName) {
    if (orchestrator.getAppsConfig().find(a => a.name === updates.name)) {
      return NextResponse.json({ error: 'App name already exists' }, { status: 400 });
    }
  }

  if (updates.cwd && !fs.existsSync(updates.cwd as string)) {
    return NextResponse.json({ error: 'CWD path does not exist' }, { status: 400 });
  }

  orchestrator.update(appName, updates as Parameters<typeof orchestrator.update>[1]);
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  const appName = decodeURIComponent(name);
  orchestrator.remove(appName);
  return NextResponse.json({ success: true });
}
