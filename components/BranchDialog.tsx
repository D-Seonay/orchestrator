'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ProjectView, SwitchResult } from '@/lib/types';
import { requestJson } from '@/components/useDashboard';
import { BTN, BTN_PRIMARY, ICON_BTN, INPUT, LABEL, TAG } from '@/components/ui';

interface Props {
  /** Projets ciblés (services et/ou base de données). */
  names: string[];
  projects: ProjectView[];
  onClose: () => void;
}


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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,15,15,0.25)] p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Changer de branche" className="w-full max-w-xl max-h-full flex flex-col rounded-[10px] bg-white text-[13px] shadow-[0_8px_32px_rgba(15,15,15,0.16)]">
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className={LABEL}>Changer de branche</span>
            <h2 className="font-semibold text-ink truncate">{targets.map((p) => p.name).join(', ')}</h2>
          </div>
          <button className={ICON_BTN} onClick={close} disabled={busy} aria-label="Fermer" title="Fermer">
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
                    className={`${INPUT} w-full font-mono text-xs`}
                  />
                  <datalist id={listId}>
                    {branches.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </label>
                {branchesError && <p className="text-danger-text">Branches indisponibles : {branchesError}</p>}
                {!branchesError && branches.length === 0 && <p className="text-muted">Chargement des branches…</p>}
              </form>

              {(willRestart.length > 0 || willBlock.length > 0) && (
                <div className="space-y-2">
                  {willRestart.length > 0 && (
                    <p className="rounded-md bg-accent-soft px-3 py-1.5 text-ink">
                      Seront redémarrés : <span className="font-medium">{willRestart.map((p) => p.name).join(', ')}</span>
                    </p>
                  )}
                  {willBlock.length > 0 && (
                    <p className="rounded-md bg-warn-soft px-3 py-1.5 text-ink">
                      Seront bloqués (modifications locales) :{' '}
                      <span className="font-medium">{willBlock.map((p) => `${p.name} (${p.git?.dirtyFiles})`).join(', ')}</span>
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
                      <span className="font-medium text-ink">{name}</span>
                      {result.ok ? (
                        <span className={`${TAG} bg-tag text-ink-soft`}>{switchedTo}</span>
                      ) : (
                        <span className="text-warn">{failureText(result, project)}</span>
                      )}
                      {result.installed && <span className="text-muted">· npm install lancé</span>}
                      {result.restarted && <span className="text-muted">· redémarré</span>}
                      {result.ok && result.detail && <span className="text-muted">· {result.detail}</span>}
                    </li>
                  );
                })}
              </ul>

              {dirtyFailures.length > 0 && (
                <div className="space-y-2 rounded-md bg-warn-soft px-3 py-2 text-ink">
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

        <footer className="px-5 py-3 border-t border-line space-y-2">
          {error && (
            <p role="alert" className="text-danger-text">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            {!done && (
              <button
                className={BTN_PRIMARY}
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
