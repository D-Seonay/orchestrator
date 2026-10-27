'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectSettings, ProjectView, RunConfig } from '@/lib/types';
import { requestJson } from '@/components/useDashboard';
import { BTN as BASE_BTN, BTN_PRIMARY, ICON_BTN, INPUT as BASE_INPUT, LABEL } from '@/components/ui';

interface Props {
  project: ProjectView;
  onClose: () => void;
}

type ConfigChoice = Omit<RunConfig, 'env'>;
interface EnvRow {
  id: number;
  key: string;
  value: string;
}

const SECRET_KEY = /PASSWORD|SECRET|KEY|TOKEN/i;
const AUTO = '';

const BTN = `${BASE_BTN} !h-7 !px-2.5`;
// Commande et variables : police à chasse fixe, comme dans un fichier .env.
const INPUT = `${BASE_INPUT} !h-7 font-mono text-xs`;

const originLabel = (launch: ProjectSettings['launch']) => {
  if (!launch) return 'aucune commande de lancement';
  if (launch.source === 'intellij') return `IntelliJ : ${launch.configName ?? 'configuration'}`;
  return launch.source === 'package.json' ? 'package.json' : 'manuel';
};

/** Erreur de saisie bloquant l'enregistrement, ou null. */
function validate(rows: EnvRow[]): string | null {
  const seen = new Set<string>();
  for (const { key, value } of rows) {
    if (key.trim() === '') {
      if (value !== '') return 'Une variable a une valeur mais pas de nom.';
      continue;
    }
    if (/\s|=/.test(key.trim())) return `Nom de variable invalide : « ${key.trim()} » (ni espace ni « = »).`;
    if (seen.has(key.trim())) return `Variable en double : ${key.trim()}.`;
    seen.add(key.trim());
  }
  return null;
}

export default function ConfigDrawer({ project, onClose }: Props) {
  const { name } = project;
  const base = `/api/projects/${encodeURIComponent(name)}`;
  const nextId = useRef(0);
  const toRows = useCallback(
    (env: Record<string, string>): EnvRow[] => Object.entries(env).map(([key, value]) => ({ id: nextId.current++, key, value })),
    [],
  );

  const [loaded, setLoaded] = useState(false);
  const [launch, setLaunch] = useState<ProjectSettings['launch']>(null);
  const [command, setCommand] = useState('');
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [configs, setConfigs] = useState<ConfigChoice[]>([]);
  const [configKey, setConfigKey] = useState(AUTO);
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReimport, setConfirmReimport] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  const running = project.status === 'running' || project.status === 'restarting';

  const apply = useCallback(
    (settings: ProjectSettings, choices?: ConfigChoice[]) => {
      setLaunch(settings.launch);
      setCommand(settings.launch?.command ?? '');
      setRows(toRows(settings.env));
      setRevealed(new Set());
      setDirty(false);
      const configName = settings.launch?.source === 'intellij' ? settings.launch.configName : undefined;
      const current = configName ? (choices ?? []).find((c) => c.name === configName) : undefined;
      if (choices) setConfigKey(current?.key ?? AUTO);
    },
    [toRows],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([requestJson<ProjectSettings>(`${base}/settings`), requestJson<ConfigChoice[]>(`${base}/reimport`)])
      .then(([settings, choices]) => {
        if (cancelled) return;
        setConfigs(choices);
        apply(settings, choices);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Erreur inconnue' });
      });
    return () => {
      cancelled = true;
    };
  }, [base, apply]);

  const close = useCallback(() => {
    if (dirty && !window.confirm('Abandonner les modifications non enregistrées ?')) return;
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const run = async (call: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await call();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Erreur inconnue' });
    } finally {
      setBusy(false);
    }
  };

  const problem = useMemo(() => validate(rows), [rows]);
  const edit = (change: () => void) => {
    change();
    setDirty(true);
    setMessage(null);
  };
  const updateRow = (id: number, patch: Partial<EnvRow>) => edit(() => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))));
  const toggleReveal = (id: number) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const save = () =>
    run(async () => {
      if (problem) throw new Error(problem);
      if (launch && command.trim() === '') throw new Error('La commande ne peut pas être vide.');
      const env = Object.fromEntries(rows.filter((r) => r.key.trim() !== '').map((r) => [r.key.trim(), r.value]));
      // La commande n'est envoyée que si elle a changé : l'envoyer telle quelle ferait passer l'origine à « manuel ».
      const changed = command.trim() !== '' && command.trim() !== launch?.command;
      const body = changed ? { command: command.trim(), env } : { env };
      apply(await requestJson<ProjectSettings>(`${base}/settings`, 'PUT', body));
      setNeedsRestart(running);
      setMessage({ kind: 'ok', text: 'Configuration enregistrée.' });
    });

  const reimport = () =>
    run(async () => {
      setConfirmReimport(false);
      const settings = await requestJson<ProjectSettings>(`${base}/reimport`, 'POST', configKey === AUTO ? {} : { configKey });
      apply(settings, configs);
      setNeedsRestart(running);
      setMessage({ kind: 'ok', text: 'Configuration réimportée.' });
    });

  const restart = () =>
    run(async () => {
      await requestJson(`/api/projects/action`, 'POST', { names: [name], action: 'restart' });
      setNeedsRestart(false);
      setMessage({ kind: 'ok', text: 'Redémarrage demandé.' });
    });

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-[rgba(15,15,15,0.25)]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Configuration de ${name}`}
        className="h-full w-full max-w-2xl flex flex-col bg-white text-[13px] shadow-[0_0_24px_rgba(15,15,15,0.12)]"
      >
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className={LABEL}>Configuration</span>
            <h2 className="text-base font-semibold text-ink truncate">{name}</h2>
          </div>
          <button className={ICON_BTN} onClick={close} aria-label="Fermer la configuration" title="Fermer">
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {!loaded ? (
            <p className="text-muted">{message?.kind === 'error' ? '' : 'Chargement…'}</p>
          ) : (
            <>
              <section className="space-y-2">
                <label className="block space-y-1">
                  <span className={LABEL}>Commande</span>
                  <input
                    value={command}
                    onChange={(e) => edit(() => setCommand(e.target.value))}
                    placeholder="ex. npm run start"
                    spellCheck={false}
                    className={`${INPUT} w-full`}
                  />
                </label>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-soft">
                  <dt className={LABEL}>Dossier</dt>
                  <dd className="break-all font-mono text-xs" title="Lecture seule">
                    {launch?.cwd ?? project.path}
                  </dd>
                  <dt className={LABEL}>Origine</dt>
                  <dd>{originLabel(launch)}</dd>
                </dl>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={LABEL}>Variables d’environnement ({rows.length})</span>
                  <button
                    className={BTN}
                    onClick={() => edit(() => setRows((prev) => [...prev, { id: nextId.current++, key: '', value: '' }]))}
                  >
                    + Ajouter
                  </button>
                </div>
                {rows.length === 0 && <p className="text-muted">Aucune variable.</p>}
                {rows.map((row) => {
                  const secret = SECRET_KEY.test(row.key);
                  const shown = !secret || revealed.has(row.id);
                  return (
                    <div key={row.id} className="flex items-center gap-2">
                      <input
                        value={row.key}
                        onChange={(e) => updateRow(row.id, { key: e.target.value })}
                        placeholder="NOM"
                        aria-label="Nom de la variable"
                        spellCheck={false}
                        className={`${INPUT} w-2/5 font-semibold`}
                      />
                      <input
                        value={row.value}
                        onChange={(e) => updateRow(row.id, { value: e.target.value })}
                        type={shown ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="valeur"
                        aria-label={`Valeur de ${row.key || 'la variable'}`}
                        spellCheck={false}
                        className={`${INPUT} flex-1 min-w-0`}
                      />
                      {secret ? (
                        <button
                          className={BTN}
                          onClick={() => toggleReveal(row.id)}
                          aria-pressed={shown}
                          aria-label={shown ? 'Masquer la valeur' : 'Afficher la valeur'}
                          title={shown ? 'Masquer la valeur' : 'Afficher la valeur'}
                        >
                          {shown ? '🙈' : '👁'}
                        </button>
                      ) : (
                        <span className="w-7 shrink-0" aria-hidden />
                      )}
                      <button
                        className={`${ICON_BTN} enabled:hover:text-danger-text`}
                        onClick={() => edit(() => setRows((prev) => prev.filter((r) => r.id !== row.id)))}
                        aria-label={`Supprimer ${row.key || 'la variable'}`}
                        title="Supprimer"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </section>

              <section className="space-y-2 border-t border-line pt-5">
                <span className={LABEL}>Réimporter</span>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={configKey}
                    onChange={(e) => setConfigKey(e.target.value)}
                    aria-label="Configuration IntelliJ à importer"
                    className={`${BASE_INPUT} !h-7 min-w-0 max-w-full flex-1`}
                  >
                    <option value={AUTO}>Détection automatique</option>
                    {configs.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.name}
                        {c.temporary ? ' (temporaire)' : ''} — {c.command}
                      </option>
                    ))}
                  </select>
                  <button className={BTN} disabled={busy} onClick={() => setConfirmReimport(true)}>
                    Réimporter depuis IntelliJ/.env
                  </button>
                </div>
                {configs.length === 0 && <p className="text-muted">Aucune configuration IntelliJ trouvée pour ce projet.</p>}
                {confirmReimport && (
                  <div role="alertdialog" className="flex flex-wrap items-center gap-2 rounded-md bg-warn-soft px-3 py-2 text-ink">
                    <span className="flex-1">Réimporter remplace la commande et les variables actuelles. Continuer ?</span>
                    <button className={BTN} disabled={busy} onClick={reimport}>
                      Remplacer
                    </button>
                    <button className={BTN} onClick={() => setConfirmReimport(false)}>
                      Annuler
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-line space-y-2">
          {message && (
            <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-danger-text' : 'text-ok-text'}>
              {message.text}
            </p>
          )}
          {problem && dirty && <p className="text-warn">{problem}</p>}
          {needsRestart && running && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-warn-soft px-3 py-1.5 text-ink">
              <span>Redémarrer pour appliquer.</span>
              <button className={BTN} disabled={busy} onClick={restart}>
                Redémarrer
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Stocké dans Orchestrator — vos dépôts ne sont pas modifiés.</span>
            <button className={BTN_PRIMARY} disabled={!loaded || !dirty || busy || problem !== null} onClick={save}>
              Enregistrer
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
