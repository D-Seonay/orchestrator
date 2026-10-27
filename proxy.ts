import { NextResponse, type NextRequest } from 'next/server';
import { isLocalHost } from './lib/api';

/** Les routes d'API (dont les variables d'environnement des projets) ne répondent qu'à un Host local. */
export function proxy(request: NextRequest) {
  if (!isLocalHost(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Hôte non autorisé' }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
