'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogLine, ProjectView, RunStatus } from '@/lib/types';
import { isErrorLog, stripAnsi } from '@/lib/utils';

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
const PALETTE = ['text-cyan-400', 'text-fuchsia-400', 'text-yellow-400', 'text-green-400', 'text-sky-400', 'text-orange-400', 'text-pink-400', 'text-lime-400'];

const STATUS_DOT: Record<RunStatus, string> = {
  running: 'bg-green-500',
  restarting: 'bg-orange-500 animate-pulse',
  failed: 'bg-red-500',
  stopped: 'bg-zinc-600',
};

const BTN =
  'h-7 px-2 text-xs border border-zinc-700 text-zinc-300 transition-colors enabled:hover:border-zinc-400 enabled:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed';
const INPUT = 'h-7 px-2 text-xs bg-black border border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400';

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
          <mark key={i} className="bg-yellow-400 text-black">
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
  const tone = line.stream === 'err' ? 'text-red-400' : line.stream === 'sys' ? 'text-zinc-500 italic' : 'text-zinc-300';
  return (
    <div className="flex gap-2 px-3 hover:bg-zinc-900/60">
      <span className="text-zinc-600 tabular-nums shrink-0">{timeFmt.format(line.ts)}</span>
      <span className={`${color} w-32 shrink-0 truncate font-bold`} title={line.project}>
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
    <section aria-label="Logs" className="fixed inset-x-0 bottom-0 z-20 h-[40vh] flex flex-col border-t border-zinc-600 bg-black">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 border-b border-zinc-800 bg-zinc-950 text-xs">
        <span className="text-[10px] uppercase tracking-widest text-zinc-600">Logs</span>

        <span className="flex flex-wrap items-center gap-3">
          {names.map((name, i) => (
            <label key={name} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={!hidden.has(name)} onChange={() => toggleProject(name)} className="accent-zinc-300" />
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[statusOf(name)]}`} aria-hidden />
              <span className={`${PALETTE[i % PALETTE.length]} font-bold`}>{name}</span>
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
          <label className="flex items-center gap-1.5 text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={matchOnly} onChange={(e) => setMatchOnly(e.target.checked)} className="accent-zinc-300" />
            Seulement les lignes correspondantes
          </label>
          <label className="flex items-center gap-1.5 text-zinc-400 cursor-pointer">
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} className="accent-zinc-300" />
            Erreurs seulement
          </label>
          <button className={BTN} onClick={clear}>
            Effacer
          </button>
          <button className={BTN} onClick={onClose} aria-label="Fermer le panneau de logs" title="Fermer">
            ×
          </button>
        </span>
      </div>

      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto py-1 text-xs leading-5">
        {shown.length === 0 ? (
          <p className="px-3 py-2 text-zinc-600">{merged.length === 0 ? 'Aucune ligne de log pour le moment.' : 'Aucune ligne ne correspond aux filtres.'}</p>
        ) : (
          shown.map((l) => (
            <LogRow key={`${l.project}:${l.seq}`} line={l} color={PALETTE[names.indexOf(l.project) % PALETTE.length]} pattern={pattern} />
          ))
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-1 border-t border-zinc-800 bg-zinc-950 text-[10px] text-zinc-500">
        <span>
          {shown.length} ligne(s) affichée(s) sur {merged.length}
          {visible.length > RENDER_LIMIT && ` (les ${RENDER_LIMIT} dernières)`}
        </span>
        {!follow && (
          <button className="text-zinc-300 hover:text-white" onClick={() => setFollow(true)}>
            ↓ Reprendre le suivi
          </button>
        )}
      </div>
    </section>
  );
}
