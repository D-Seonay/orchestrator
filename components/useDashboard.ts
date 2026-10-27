'use client';

import { useEffect, useState } from 'react';
import type { DashboardPayload } from '@/lib/types';

/** Flux SSE du tableau de bord ; EventSource se reconnecte seul, `connected` reflète l'état de la liaison. */
export function useDashboard(): { data: DashboardPayload | null; connected: boolean } {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/sse');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      try {
        setData(JSON.parse(event.data) as DashboardPayload);
        setConnected(true);
      } catch {
        // message illisible : on garde le dernier état connu
      }
    };
    return () => source.close();
  }, []);

  return { data, connected };
}

/** Appel d'une route (l'en-tête JSON est exigé par la garde CSRF des routes mutantes). Lève avec le message d'erreur du serveur. */
export async function requestJson<T = unknown>(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return (await res.json().catch(() => undefined)) as T;
  let message = `Erreur ${res.status}`;
  try {
    const payload = (await res.json()) as { error?: unknown };
    if (typeof payload.error === 'string') message = payload.error;
  } catch {
    // corps non JSON : message générique
  }
  throw new Error(message);
}

/** Appel d'une route mutante dont la réponse est ignorée. */
export const sendJson = async (url: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<void> => {
  await requestJson(url, method, body);
};
