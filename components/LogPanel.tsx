'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogLine, ProjectView, RunStatus } from '@/lib/types';
import { isErrorLog, stripAnsi } from '@/lib/utils';
import { ICON_BTN, BTN as BASE_BTN, INPUT as BASE_INPUT, LABEL } from './ui';

interface Props {
  /** Projets dont les logs sont ouverts (ordre d'ouverture = ordre des couleurs). */
  names: string[];
  projects: ProjectView[];
  /** Liaison SSE du tableau de bord : un retour de connexion déclenche une resynchronisation. */
  connected: boolean;
  onClose: () => void;
}

const POLL_MS = 1000;
const FETCH_TIMEOUT_MS = 5000;
const BUFFER_SIZE = 5000;
const RENDER_LIMIT = 2000;
const FOLLOW_THRESHOLD_PX = 24;

// Classes littérales (Tailwind ne détecte pas les noms construits dynamiquement).
// Couleurs de texte Notion (bleu, violet, orange, vert, rose, marron, rouge, jaune).
const PALETTE = ['text-[#337ea9]', 'text-[#9065b0]', 'text-[#d9730d]', 'text-[#448361]', 'text-[#c14c8a]', 'text-[#9f6b53]', 'text-[#d44c47]', 'text-[#cb912f]'];

const STATUS_DOT: Record<RunStatus, string> = {
  running: 'bg-ok',
  restarting: 'bg-warn animate-pulse',
  failed: 'bg-danger',
  stopped: 'bg-idle',
};

const BTN = `${BASE_BTN} !h-7 !px-2.5`;
const INPUT = `${BASE_INPUT} !h-7`;

interface TaggedLine extends LogLine {
  project: string;
}

/**
 * Interroge /logs?since=<dernier seq> de chaque projet ouvert, toutes les secondes, et garde 5000 lignes par projet.
 * Après un échec réseau ou une reconnexion SSE, le serveur a pu redémarrer (seq repart de 0) :
 * les projets ouverts sont alors resynchronisés (since=0, tampon remplacé).
 */
function useLogBuffers(names: string[], connected: boolean) {
  const [buffers, setBuffers] = useState<Record<string, LogLine[]>>({});
  const lastSeq = useRef<Record<string, number>>({});
  const needsResync = useRef(new Set<string>());
  const wasConnected = useRef(connected);
  const namesKey = names.join('\n');

  // Reconnexion SSE (déconnecté → connecté) : tous les projets ouverts sont à resynchroniser.
  useEffect(() => {
    if (connected && !wasConnected.current) namesKey.split('\n').forEach((n) => needsResync.current.add(n));
    wasConnected.current = connected;
  }, [connected, namesKey]);

  useEffect(() => {
    const open = namesKey.split('\n');
    const inFlight = new Set<string>();
    const controllers = new Set<AbortController>();
    let cancelled = false;

    const markAllForResync = () => open.forEach((n) => needsResync.current.add(n));

    const poll = async (name: string) => {
      if (inFlight.has(name)) return;
      inFlight.add(name);
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const resync = needsResync.current.has(name);
        const since = resync ? 0 : (lastSeq.current[name] ?? 0);
        const res = await fetch(`/api/projects/${encodeURIComponent(name)}/logs?since=${since}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!res.ok) {
          markAllForResync();
          return;
        }
        const fresh = (await res.json()) as LogLine[];
        if (cancelled) return;
        const lines = fresh.map((l) => ({ ...l, text: stripAnsi(l.text) }));
        if (resync) {
          // seq a pu repartir de 0 : on repart de zéro et on remplace le tampon (clés `${projet}:${seq}` sans collision).
          needsResync.current.delete(name);
          lastSeq.current[name] = fresh.length > 0 ? fresh[fresh.length - 1].seq : 0;
          setBuffers((prev) => ({ ...prev, [name]: lines.slice(-BUFFER_SIZE) }));
          return;
        }
        if (fresh.length === 0) return;
        lastSeq.current[name] = fresh[fresh.length - 1].seq;
        setBuffers((prev) => ({ ...prev, [name]: [...(prev[name] ?? []), ...lines].slice(-BUFFER_SIZE) }));
      } catch {
        // serveur injoignable ou requête expirée : il a pu redémarrer, on resynchronise au prochain succès
        if (!cancelled) markAllForResync();
      } finally {
        clearTimeout(timeout);
        controllers.delete(controller);
        inFlight.delete(name);
      }
    };

    const tick = () => open.forEach((n) => void poll(n));
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      controllers.forEach((c) => c.abort());
    };
  }, [namesKey]);

  // « Effacer » ne vide que l'affichage : lastSeq est conservé, les lignes déjà vues ne reviennent pas.
  const clear = useCallback(() => setBuffers({}), []);
  return { buffers, clear };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function Highlighted({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern) return <>{text}</>;
  // split() avec un groupe capturant : les indices impairs sont les correspondances.
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-note-soft text-ink rounded-sm">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function LogRow({ line, color, pattern }: { line: TaggedLine; color: string; pattern: RegExp | null }) {
  const tone = line.stream === 'err' ? 'text-danger-text' : line.stream === 'sys' ? 'text-muted italic' : 'text-ink';
  return (
    <div className="flex gap-2 px-4 hover:bg-line-soft">
      <span className="text-muted tabular-nums shrink-0">{timeFmt.format(line.ts)}</span>
      <span className={`${color} w-32 shrink-0 truncate font-medium`} title={line.project}>
        {line.project}
      </span>
      <span className={`${tone} whitespace-pre-wrap break-all min-w-0`}>
        <Highlighted text={line.text} pattern={pattern} />
      </span>
    </div>
  );
}

export default function LogPanel({ names, projects, connected, onClose }: Props) {
  const { buffers, clear } = useLogBuffers(names, connected);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [matchOnly, setMatchOnly] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  const pattern = useMemo(() => (query === '' ? null : new RegExp(`(${escapeRegExp(query)})`, 'i')), [query]);

  const merged = useMemo(() => {
    const rank = new Map(names.map((n, i) => [n, i]));
    const all: TaggedLine[] = [];
    for (const name of names) {
      if (hidden.has(name)) continue;
      for (const l of buffers[name] ?? []) all.push({ ...l, project: name });
    }
    return all.sort((a, b) => a.ts - b.ts || a.seq - b.seq || rank.get(a.project)! - rank.get(b.project)!);
  }, [buffers, names, hidden]);

  const visible = useMemo(() => {
    const lower = query.toLowerCase();
    return merged.filter(
      (l) => (!errorsOnly || isErrorLog(l.text)) && (!matchOnly || lower === '' || l.text.toLowerCase().includes(lower)),
    );
  }, [merged, errorsOnly, matchOnly, query]);
  const shown = visible.length > RENDER_LIMIT ? visible.slice(-RENDER_LIMIT) : visible;

  // Auto-scroll : suspendu dès que l'utilisateur remonte, repris quand il revient en bas.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [shown, follow]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX);
  };

  const toggleProject = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const statusOf = (name: string) => projects.find((p) => p.name === name)?.status ?? 'stopped';

  return (
    <section aria-label="Logs" className="fixed inset-x-0 bottom-0 z-20 h-[40vh] flex flex-col border-t border-line bg-white shadow-[0_-4px_16px_rgba(15,15,15,0.06)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b border-line text-[13px]">
        <span className="font-semibold text-ink">Logs</span>

        <span className="flex flex-wrap items-center gap-3">
          {names.map((name, i) => (
            <label key={name} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={!hidden.has(name)} onChange={() => toggleProject(name)} className="accent-accent" />
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[statusOf(name)]}`} aria-hidden />
              <span className={`${PALETTE[i % PALETTE.length]} font-medium`}>{name}</span>
            </label>
          ))}
        </span>

        <span className="flex flex-wrap items-center gap-2 ml-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher…"
            aria-label="Rechercher dans les logs"
            spellCheck={false}
            className={`${INPUT} w-48`}
          />
          <label className="flex items-center gap-1.5 text-ink-soft cursor-pointer">
            <input type="checkbox" checked={matchOnly} onChange={(e) => setMatchOnly(e.target.checked)} className="accent-accent" />
            Seulement les lignes correspondantes
          </label>
          <label className="flex items-center gap-1.5 text-ink-soft cursor-pointer">
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} className="accent-accent" />
            Erreurs seulement
          </label>
          <button className={BTN} onClick={clear}>
            Effacer
          </button>
          <button className={ICON_BTN} onClick={onClose} aria-label="Fermer le panneau de logs" title="Fermer">
            ×
          </button>
        </span>
      </div>

      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto py-2 bg-code font-mono text-xs leading-5">
        {shown.length === 0 ? (
          <p className="px-4 py-2 font-sans text-[13px] text-muted">{merged.length === 0 ? 'Aucune ligne de log pour le moment.' : 'Aucune ligne ne correspond aux filtres.'}</p>
        ) : (
          shown.map((l) => (
            <LogRow key={`${l.project}:${l.seq}`} line={l} color={PALETTE[names.indexOf(l.project) % PALETTE.length]} pattern={pattern} />
          ))
        )}
      </div>

      <div className={`flex items-center justify-between px-4 py-1 border-t border-line ${LABEL}`}>
        <span>
          {shown.length} ligne(s) affichée(s) sur {merged.length}
          {visible.length > RENDER_LIMIT && ` (les ${RENDER_LIMIT} dernières)`}
        </span>
        {!follow && (
          <button className="text-accent hover:text-accent-strong" onClick={() => setFollow(true)}>
            ↓ Reprendre le suivi
          </button>
        )}
      </div>
    </section>
  );
}
