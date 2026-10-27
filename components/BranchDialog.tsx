'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ProjectView, SwitchResult } from '@/lib/types';
import { requestJson } from '@/components/useDashboard';

interface Props {
  /** Projets ciblés (services et/ou base de données). */
  names: string[];
  projects: ProjectView[];
  onClose: () => void;
}

const BTN =
  'h-8 px-3 text-xs border border-zinc-700 text-zinc-300 transition-colors enabled:hover:border-zinc-400 enabled:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed';
const INPUT = 'h-8 px-2 text-xs bg-black border border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400';
const LABEL = 'text-[10px] uppercase tracking-widest text-zinc-600';

const isActive = (p: ProjectView) => p.status === 'running' || p.status === 'restarting';

/** Raison d'un échec, en français. */
function failureText(result: SwitchResult, project: ProjectView | undefined): string {
  switch (result.reason) {
    case 'dirty': {
      const count = project?.git?.dirtyFiles ?? 0;
      return count > 0 ? `${count} fichier${count > 1 ? 's' : ''} modifié${count > 1 ? 's' : ''}` : (result.detail ?? 'modifications locales');
    }
    case 'branch-not-found':
      return 'branche introuvable';
    case 'not-fast-forward':
      return 'basculé mais pas à jour (commits locaux)';
    case 'busy':
      return 'opération déjà en cours';
    default:
      return result.detail ? `erreur : ${result.detail}` : 'erreur';
  }
}

export default function BranchDialog({ names, projects, onClose }: Props) {
  const listId = useId();
  const targets = useMemo(
    () => names.map((n) => projects.find((p) => p.name === n)).filter((p): p is ProjectView => p !== undefined),
    [names, projects],
  );
  const targetNames = useMemo(() => targets.map((p) => p.name), [targets]);
  // Clé stable : le rechargement des branches ne dépend pas des rafraîchissements SSE.
  const namesKey = targetNames.join(',');

  const [branches, setBranches] = useState<string[]>([]);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dernier résultat par projet : le relancer avec stash remplace l'entrée des projets concernés.
  const [results, setResults] = useState<Record<string, SwitchResult> | null>(null);
  const [switchedTo, setSwitchedTo] = useState('');

  useEffect(() => {
    let cancelled = false;
    requestJson<string[]>(`/api/branches?names=${encodeURIComponent(namesKey)}`)
      .then((list) => !cancelled && setBranches(list))
      .catch((e: unknown) => !cancelled && setBranchesError(e instanceof Error ? e.message : 'Erreur inconnue'));
    return () => {
      cancelled = true;
    };
  }, [namesKey]);

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const run = async (scope: string[], target: string, stash: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const list = await requestJson<SwitchResult[]>('/api/branches/switch', 'POST', { names: scope, branch: target, stash });
      setResults((prev) => ({ ...prev, ...Object.fromEntries(list.map((r) => [r.name, r])) }));
      setSwitchedTo(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  };

  const target = branch.trim();
  const willRestart = targets.filter((p) => p.kind === 'service' && isActive(p));
  const willBlock = targets.filter((p) => (p.git?.dirtyFiles ?? 0) > 0);

  const dirtyFailures = results ? Object.values(results).filter((r) => r.reason === 'dirty') : [];
  const done = results !== null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Changer de branche" className="w-full max-w-xl max-h-full flex flex-col border border-zinc-600 bg-zinc-950 text-xs">
        <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-800">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className={LABEL}>Changer de branche</span>
            <h2 className="text-zinc-100 font-bold truncate">{targets.map((p) => p.name).join(', ')}</h2>
          </div>
          <button className={BTN} onClick={close} disabled={busy} aria-label="Fermer" title="Fermer">
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {!done && (
            <>
              <form
                className="space-y-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (target !== '' && !busy) void run(targetNames, target, false);
                }}
              >
                <label className="block space-y-1">
                  <span className={LABEL}>Branche cible</span>
                  <input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    list={listId}
                    placeholder="ex. staging"
                    spellCheck={false}
                    autoFocus
                    autoComplete="off"
                    className={`${INPUT} w-full`}
                  />
                  <datalist id={listId}>
                    {branches.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </label>
                {branchesError && <p className="text-red-400">Branches indisponibles : {branchesError}</p>}
                {!branchesError && branches.length === 0 && <p className="text-zinc-600">Chargement des branches…</p>}
              </form>

              {(willRestart.length > 0 || willBlock.length > 0) && (
                <div className="space-y-2">
                  {willRestart.length > 0 && (
                    <p className="border border-yellow-700 bg-yellow-950/30 px-2 py-1 text-yellow-300">
                      Seront redémarrés : <span className="font-bold">{willRestart.map((p) => p.name).join(', ')}</span>
                    </p>
                  )}
                  {willBlock.length > 0 && (
                    <p className="border border-orange-700 bg-orange-950/30 px-2 py-1 text-orange-300">
                      Seront bloqués (modifications locales) :{' '}
                      <span className="font-bold">{willBlock.map((p) => `${p.name} (${p.git?.dirtyFiles})`).join(', ')}</span>
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {done && (
            <section className="space-y-2">
              <span className={LABEL}>Résultat</span>
              <ul className="space-y-1">
                {targetNames.map((name) => {
                  const result = results[name];
                  if (!result) return null;
                  const project = targets.find((p) => p.name === name);
                  return (
                    <li key={name} className="flex items-baseline gap-2 flex-wrap">
                      <span aria-hidden>{result.ok ? '✅' : '⚠️'}</span>
                      <span className="font-bold text-zinc-100">{name}</span>
                      {result.ok ? (
                        <span className="text-yellow-400">{switchedTo}</span>
                      ) : (
                        <span className="text-orange-400">{failureText(result, project)}</span>
                      )}
                      {result.installed && <span className="text-zinc-400">· npm install lancé</span>}
                      {result.restarted && <span className="text-zinc-400">· redémarré</span>}
                      {result.ok && result.detail && <span className="text-zinc-500">· {result.detail}</span>}
                    </li>
                  );
                })}
              </ul>

              {dirtyFailures.length > 0 && (
                <div className="space-y-2 border border-orange-700 bg-orange-950/30 px-2 py-2 text-orange-300">
                  <p>Vos modifications seront mises de côté (git stash) sur la branche actuelle, pas réappliquées.</p>
                  <button
                    className={BTN}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        dirtyFailures.map((r) => r.name),
                        switchedTo,
                        true,
                      )
                    }
                  >
                    {busy ? 'Bascule…' : 'Stasher et basculer'}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>

        <footer className="px-3 py-2 border-t border-zinc-800 space-y-2">
          {error && (
            <p role="alert" className="text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            {!done && (
              <button
                className={`${BTN} border-zinc-500 text-zinc-100`}
                disabled={target === '' || busy}
                onClick={() => void run(targetNames, target, false)}
              >
                {busy ? 'Bascule…' : 'Basculer'}
              </button>
            )}
            <button className={BTN} onClick={close} disabled={busy}>
              {done ? 'Terminer' : 'Annuler'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
