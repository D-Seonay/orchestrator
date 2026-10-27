import { NextResponse } from 'next/server';

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Protection CSRF des routes qui modifient l'état : une requête portant un en-tête `Origin`
 * dont l'hôte n'est pas local est refusée (403). Sans `Origin` (curl, outils locaux), on laisse passer.
 * Renvoie la réponse d'erreur à retourner, ou null si la requête est acceptable.
 */
export function guardMutation(req: Request): NextResponse | null {
  const origin = req.headers.get('origin');
  if (origin === null) return null;
  try {
    if (LOCAL_HOSTS.has(new URL(origin).hostname)) return null;
  } catch {
    // Origin illisible (« null » d'un contexte sandboxé, etc.) : refusé.
  }
  return fail('Origine non autorisée', 403);
}

/** Corps JSON de la requête, ou null s'il est absent, invalide ou n'est pas déclaré application/json. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return null;
  try {
    const body: unknown = await req.json();
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export const isStringRecord = (v: unknown): v is Record<string, string> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');
