import { NextResponse, type NextRequest } from 'next/server';
import { fail, isStringRecord, readJson } from '@/lib/api';
import { orchestrator } from '@/lib/orchestrator';

type Ctx = { params: Promise<{ name: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { name } = await params;
  const settings = orchestrator.getSettings(name);
  if (!settings) return fail('Projet introuvable', 404);
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { name } = await params;
  if (!orchestrator.getSettings(name)) return fail('Projet introuvable', 404);

  const body = await readJson(req);
  if (!body) return fail('Corps JSON invalide');
  const { command, env } = body;
  if (command !== undefined && (typeof command !== 'string' || command.trim() === '')) {
    return fail('command doit être une commande non vide');
  }
  if (env !== undefined && !isStringRecord(env)) return fail('env doit être un objet de chaînes');

  orchestrator.updateSettings(name, { command: command?.trim(), env });
  return NextResponse.json(orchestrator.getSettings(name));
}
