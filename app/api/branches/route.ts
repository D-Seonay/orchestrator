import { NextResponse, type NextRequest } from 'next/server';
import { orchestrator } from '@/lib/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const names = (req.nextUrl.searchParams.get('names') ?? '').split(',').filter((n) => n !== '');
  return NextResponse.json(await orchestrator.branches(names));
}
