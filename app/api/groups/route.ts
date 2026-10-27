import { NextResponse, type NextRequest } from 'next/server';
import { fail, guardMutation, isStringArray, readJson } from '@/lib/api';
import { orchestrator } from '@/lib/orchestrator';

export async function PUT(req: NextRequest) {
  const denied = guardMutation(req);
  if (denied) return denied;
  const body = await readJson(req);
  if (!body) return fail('Corps JSON invalide');
  const { name, members } = body;
  if (typeof name !== 'string' || name.trim() === '') return fail('name est requis');
  if (!isStringArray(members)) return fail('members doit être une liste de noms');

  orchestrator.saveGroup(name.trim(), members);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const denied = guardMutation(req);
  if (denied) return denied;
  const name = req.nextUrl.searchParams.get('name');
  if (!name) return fail('name est requis');

  orchestrator.deleteGroup(name);
  return NextResponse.json({ success: true });
}
