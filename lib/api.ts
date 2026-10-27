import { NextResponse } from 'next/server';

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Corps JSON de la requête, ou null s'il est absent ou invalide. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
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
