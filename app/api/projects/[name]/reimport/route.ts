import { NextResponse, type NextRequest } from 'next/server';
import { fail, readJson } from '@/lib/api';
import { orchestrator } from '@/lib/orchestrator';

type Ctx = { params: Promise<{ name: string }> };

/** Choix de configuration pour l'UI : clés, noms et commandes — jamais les valeurs d'environnement. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { name } = await params;
  if (!orchestrator.getSettings(name)) return fail('Projet introuvable', 404);
  const configs = orchestrator.runConfigs(name).map((c) => ({
    key: c.key, name: c.name, type: c.type, temporary: c.temporary, command: c.command, cwd: c.cwd,
  }));
  return NextResponse.json(configs);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { name } = await params;
  if (!orchestrator.getSettings(name)) return fail('Projet introuvable', 404);

  // Corps facultatif : sans configKey, la config par défaut est choisie.
  const body = (await readJson(req)) ?? {};
  const { configKey } = body;
  if (configKey !== undefined && typeof configKey !== 'string') return fail('configKey doit être une chaîne');

  try {
    return NextResponse.json(orchestrator.reimport(name, configKey));
  } catch (err) {
    return fail((err as Error).message, 404);
  }
}
