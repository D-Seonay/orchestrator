import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get('path');
  if (!p) return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  return fs.existsSync(p)
    ? NextResponse.json({ exists: true })
    : NextResponse.json({ exists: false }, { status: 404 });
}
