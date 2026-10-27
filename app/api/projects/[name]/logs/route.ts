import { NextResponse, type NextRequest } from 'next/server';
import { fail } from '@/lib/api';
import { orchestrator } from '@/lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0');
  if (!Number.isInteger(since) || since < 0) return fail('since doit être un entier positif');
  return NextResponse.json(orchestrator.logs(name, since));
}
