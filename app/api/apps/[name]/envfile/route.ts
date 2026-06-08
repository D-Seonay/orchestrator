import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

type Params = { params: Promise<{ name: string }> };

// Find where the .env file lives for this app.
// Priority: {cwd}/.env if exists → {dashboard_root}/.env.{name}
function resolveEnvFilePath(appName: string, cwd?: string): string {
  if (cwd) {
    const cwdEnv = path.join(cwd, '.env');
    if (fs.existsSync(cwdEnv)) return cwdEnv;
  }
  return path.join(process.cwd(), `.env.${appName}`);
}

// Read cwd from apps.config.json directly — avoids orchestrator module dependency
function getAppCwd(appName: string): string | undefined {
  try {
    const config: { name: string; cwd?: string }[] = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'apps.config.json'), 'utf8')
    );
    return config.find(a => a.name === appName)?.cwd;
  } catch {
    return undefined;
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  const appName = decodeURIComponent(name);

  const cwd = getAppCwd(appName);
  const filePath = resolveEnvFilePath(appName, cwd);
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

  return NextResponse.json({ content, path: filePath });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const appName = decodeURIComponent(name);

  let body: { content: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const cwd = getAppCwd(appName);
  const filePath = resolveEnvFilePath(appName, cwd);

  try {
    fs.writeFileSync(filePath, body.content, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Cannot write file: ${msg}` }, { status: 500 });
  }

  // Best-effort restart — don't fail the save if restart fails
  try {
    const { orchestrator } = await import('@/lib/orchestrator');
    orchestrator.restart(appName);
  } catch { /* ignore */ }

  return NextResponse.json({ success: true, path: filePath });
}
