import { NextResponse, type NextRequest } from 'next/server';
import { fail, guardMutation, isStringArray, readJson } from '@/lib/api';
import { orchestrator } from '@/lib/orchestrator';

export async function POST(req: NextRequest) {
  const denied = guardMutation(req);
  if (denied) return denied;
  const body = await readJson(req);
  if (!body) return fail('Corps JSON invalide');
  const { names, branch, stash } = body;
  if (!isStringArray(names)) return fail('names doit être une liste de noms');
  if (typeof branch !== 'string' || branch.trim() === '') return fail('branch est requis');
  if (stash !== undefined && typeof stash !== 'boolean') return fail('stash doit être un booléen');

  return NextResponse.json(await orchestrator.switchBranches(names, branch.trim(), { stash: stash === true }));
}
