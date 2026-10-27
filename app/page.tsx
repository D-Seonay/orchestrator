'use client';

import { useCallback, useMemo, useState } from 'react';
import ProjectTable, { type RowAction } from '@/components/ProjectTable';
import LogPanel from '@/components/LogPanel';
import Toolbar from '@/components/Toolbar';
import { sendJson, useDashboard } from '@/components/useDashboard';

export default function DashboardPage() {
  const { data, connected } = useDashboard();
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [logNames, setLogNames] = useState<string[]>([]);

  const services = useMemo(() => data?.projects.filter((p) => p.kind === 'service') ?? [], [data]);
  const database = data?.projects.find((p) => p.kind === 'database') ?? null;
  // La sélection ne garde que des projets encore présents (dossier supprimé, racine changée…).
  const selected = useMemo(() => services.map((p) => p.name).filter((n) => selection.has(n)), [services, selection]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const request = useCallback(async (call: () => Promise<void>) => {
    try {
      await call();
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
      return false;
    }
  }, []);

  const act = useCallback(
    (names: string[], action: RowAction) => void request(() => sendJson('/api/projects/action', 'POST', { names, action })),
    [request],
  );

  const toggle = (name: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const toggleAll = (names: string[], checked: boolean) => setSelection(checked ? new Set(names) : new Set());

  // Ouvrir des logs complète le panneau déjà ouvert (ordre d'ouverture conservé).
  const openLogs = (names: string[]) => setLogNames((prev) => [...prev, ...names.filter((n) => !prev.includes(n))]);

  // Tasks 9–10 : tiroir de configuration, dialogue de changement de branche.
  const openConfig = (name: string) => void name;
  const switchBranch = (names: string[]) => void names;

  return (
    <div className={`min-h-screen flex flex-col ${logNames.length > 0 ? 'pb-[40vh]' : ''}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-3 py-3">
        <div className="flex items-center gap-3">
          <span className="text-zinc-600 font-bold tracking-widest text-sm">ATD//</span>
          <h1 className="text-zinc-300 text-xs tracking-wider uppercase">Orchestrator</h1>
        </div>
        <div className="flex items-center gap-5 text-xs">
          {data && (
            <span className="text-zinc-400" title="Base de données gérée à part (non lançable)">
              Base : <span className="text-zinc-100">{data.dbVersion ?? 'version inconnue'}</span>
              {database?.git && <span className="text-yellow-400"> ({database.git.branch})</span>}
            </span>
          )}
          <span className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} aria-hidden />
            <span className={`uppercase tracking-widest ${connected ? 'text-zinc-500' : 'text-red-400'}`}>
              {connected ? 'Connecté' : 'Reconnexion…'}
            </span>
          </span>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 px-3 py-2 text-xs bg-red-950/50 border-b border-red-900 text-red-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Fermer l’erreur" className="text-red-400 hover:text-red-200">
            ×
          </button>
        </div>
      )}

      {data ? (
        <>
          <Toolbar
            root={data.root}
            rootExists={data.rootExists}
            groups={data.groups}
            selected={selected}
            request={request}
            onSelectGroup={(members) => setSelection(new Set(members))}
            onAction={act}
            onSwitchBranch={switchBranch}
            onOpenLogs={openLogs}
          />
          <ProjectTable
            projects={services}
            selected={selectedSet}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onAction={act}
            onOpenLogs={openLogs}
            onOpenConfig={openConfig}
          />
        </>
      ) : (
        <p className="px-3 py-8 text-xs text-zinc-500">Connexion au serveur…</p>
      )}

      {logNames.length > 0 && <LogPanel names={logNames} projects={services} onClose={() => setLogNames([])} />}
    </div>
  );
}
