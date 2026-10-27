'use client';

import { useEffect, useState } from 'react';
import type { DashboardPayload } from '@/lib/types';

// Délai avant de recréer un EventSource que le navigateur a abandonné (état CLOSED).
const RECONNECT_DELAY_MS = 2000;
const CLOSED = 2; // EventSource.CLOSED

/** Ce dont subscribeDashboard a besoin d'un EventSource (permet de le tester sans navigateur). */
export interface SseSource {
  readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  close(): void;
}

/**
 * Abonnement au flux SSE. EventSource se reconnecte seul après une coupure, sauf s'il passe à CLOSED
 * (réponse non-SSE, erreur HTTP) : on le recrée alors après `delayMs`. Renvoie la fonction de désabonnement.
 */
export function subscribeDashboard(opts: {
  create: () => SseSource;
  onData: (payload: DashboardPayload) => void;
  onConnected: (connected: boolean) => void;
  delayMs?: number;
}): () => void {
  let source: SseSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const connect = () => {
    retry = null;
    const current = opts.create();
    source = current;
    current.onopen = () => opts.onConnected(true);
    current.onerror = () => {
      opts.onConnected(false);
      if (current.readyState === CLOSED && !disposed && retry === null) {
        retry = setTimeout(connect, opts.delayMs ?? RECONNECT_DELAY_MS);
      }
    };
    current.onmessage = (event) => {
      try {
        opts.onData(JSON.parse(event.data) as DashboardPayload);
        opts.onConnected(true);
      } catch {
        // message illisible : on garde le dernier état connu
      }
    };
  };

  connect();
  return () => {
    disposed = true;
    if (retry !== null) clearTimeout(retry);
    source?.close();
  };
}

/** Flux SSE du tableau de bord ; `connected` reflète l'état de la liaison. */
export function useDashboard(): { data: DashboardPayload | null; connected: boolean } {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(
    () => subscribeDashboard({ create: () => new EventSource('/api/sse'), onData: setData, onConnected: setConnected }),
    [],
  );

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
