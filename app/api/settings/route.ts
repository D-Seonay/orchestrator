import { NextResponse, type NextRequest } from 'next/server';
import { fail, readJson } from '@/lib/api';
import { orchestrator } from '@/lib/orchestrator';

export async function PUT(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return fail('Corps JSON invalide');
  const { root } = body;
  if (typeof root !== 'string' || root.trim() === '') return fail('root est requis');

  orchestrator.setRoot(root.trim());
  return NextResponse.json({ success: true });
}
