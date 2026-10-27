'use client';

import { useCallback, useMemo, useState } from 'react';
import ProjectTable, { type RowAction } from '@/components/ProjectTable';
import BranchDialog from '@/components/BranchDialog';
import ConfigDrawer from '@/components/ConfigDrawer';
import LogPanel from '@/components/LogPanel';
import Toolbar from '@/components/Toolbar';
import { ICON_BTN } from '@/components/ui';
import { sendJson, useDashboard } from '@/components/useDashboard';

export default function DashboardPage() {
  const { data, connected } = useDashboard();
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [logNames, setLogNames] = useState<string[]>([]);
  const [configName, setConfigName] = useState<string | null>(null);
  const [branchNames, setBranchNames] = useState<string[] | null>(null);

  const services = useMemo(() => data?.projects.filter((p) => p.kind === 'service') ?? [], [data]);
  const database = data?.projects.find((p) => p.kind === 'database') ?? null;
  // La sélection ne garde que des projets encore présents (dossier supprimé, racine changée…).
  const selected = useMemo(() => services.map((p) => p.name).filter((n) => selection.has(n)), [services, selection]);
  // Le tiroir se ferme de lui-même si le projet disparaît (dossier supprimé, racine changée…).
  const configProject = services.find((p) => p.name === configName) ?? null;
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

  return (
    <div className={`min-h-screen flex flex-col ${logNames.length > 0 ? 'pb-[40vh]' : ''}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 px-8 pt-7 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink">🚦 Orchestrator</h1>
        <div className="flex items-center gap-4 text-[13px] text-muted">
          {data && (
            <span className="flex items-center gap-1.5" title="Base de données gérée à part (non lançable)">
              Base <span className="font-mono text-ink-soft">{data.dbVersion ?? 'version inconnue'}</span>
              {database?.git && <span className="font-mono">· {database.git.branch}</span>}
              {database?.git && (
                <button
                  onClick={() => setBranchNames([database.name])}
                  disabled={database.busy}
                  className={ICON_BTN}
                  title="Changer la branche de la base"
                  aria-label="Changer la branche de la base"
                >
                  ⎇
                </button>
              )}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-ok' : 'bg-danger animate-pulse'}`} aria-hidden />
            <span className={connected ? '' : 'text-danger-text'}>{connected ? 'Connecté' : 'Reconnexion…'}</span>
          </span>
        </div>
      </header>

      {error && (
        <div role="alert" className="mx-8 mb-3 flex items-center justify-between gap-3 rounded-md px-3 py-2 text-[13px] bg-danger-soft text-danger-text">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Fermer l’erreur" className="opacity-70 hover:opacity-100">
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
            onSwitchBranch={setBranchNames}
            onOpenLogs={openLogs}
          />
          <ProjectTable
            projects={services}
            selected={selectedSet}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onAction={act}
            onOpenLogs={openLogs}
            onOpenConfig={setConfigName}
            onSwitchBranch={setBranchNames}
          />
        </>
      ) : (
        <p className="px-8 py-8 text-muted">Connexion au serveur…</p>
      )}

      {configProject && <ConfigDrawer key={configProject.name} project={configProject} onClose={() => setConfigName(null)} />}

      {branchNames && data && <BranchDialog names={branchNames} projects={data.projects} onClose={() => setBranchNames(null)} />}

      {logNames.length > 0 && <LogPanel names={logNames} projects={services} connected={connected} onClose={() => setLogNames([])} />}
    </div>
  );
}
