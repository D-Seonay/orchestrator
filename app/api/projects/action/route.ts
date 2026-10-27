import { NextResponse, type NextRequest } from 'next/server';
import { fail, isStringArray, readJson } from '@/lib/api';
import { orchestrator } from '@/lib/orchestrator';

const ACTIONS = ['start', 'stop', 'restart'] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return fail('Corps JSON invalide');
  const { names, action } = body;
  if (!isStringArray(names)) return fail('names doit être une liste de noms');
  if (!ACTIONS.includes(action as Action)) return fail('Action invalide');

  await orchestrator.act(names, action as Action);
  return NextResponse.json({ success: true });
}
