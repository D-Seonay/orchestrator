import { NextRequest, NextResponse } from 'next/server';
import { orchestrator } from '@/lib/orchestrator';
import fs from 'fs';
import path from 'path';

type Params = { params: Promise<{ name: string }> };

function resolveEnvFilePath(appName: string, cwd?: string): string {
  // Prefer .env in the app's own cwd if it exists
  if (cwd) {
    const cwdEnv = path.join(cwd, '.env');
    if (fs.existsSync(cwdEnv)) return cwdEnv;
  }
  // Otherwise use .env.{name} at the dashboard root (created if missing)
  return path.join(process.cwd(), `.env.${appName}`);
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  const appName = decodeURIComponent(name);

  if (!orchestrator.getAppsConfig().find(a => a.name === appName)) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 });
  }

  const app = orchestrator.getAppsConfig().find(a => a.name === appName)!;
  const filePath = resolveEnvFilePath(appName, app.cwd);
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

  return NextResponse.json({ content, path: filePath });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const appName = decodeURIComponent(name);

  if (!orchestrator.getAppsConfig().find(a => a.name === appName)) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 });
  }

  let body: { content: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const app = orchestrator.getAppsConfig().find(a => a.name === appName)!;
  const filePath = resolveEnvFilePath(appName, app.cwd);

  fs.writeFileSync(filePath, body.content, 'utf8');

  // Restart the app so it picks up the new env values
  orchestrator.restart(appName);

  return NextResponse.json({ success: true, path: filePath });
}
