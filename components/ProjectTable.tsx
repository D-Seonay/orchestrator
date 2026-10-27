'use client';

import { useState } from 'react';
import type { ProjectView, RunStatus } from '@/lib/types';
import { formatUptime, stripAnsi } from '@/lib/utils';

export type RowAction = 'start' | 'stop' | 'restart';

interface Props {
  projects: ProjectView[];
  selected: ReadonlySet<string>;
  onToggle: (name: string) => void;
  onToggleAll: (names: string[], checked: boolean) => void;
  onAction: (names: string[], action: RowAction) => void;
  onOpenLogs: (names: string[]) => void;
  onOpenConfig: (name: string) => void;
}

const STATUS: Record<RunStatus, { label: string; dot: string; text: string }> = {
  running: { label: 'en cours', dot: 'bg-green-500', text: 'text-green-400' },
  restarting: { label: 'redémarre', dot: 'bg-orange-500 animate-pulse', text: 'text-orange-400' },
  failed: { label: 'en échec', dot: 'bg-red-500', text: 'text-red-400' },
  stopped: { label: 'arrêté', dot: 'bg-zinc-600', text: 'text-zinc-500' },
};

// Colonnes alignées sur toutes les lignes : case, statut, nom, version, branche, indicateurs, uptime, actions.
export const ROW_GRID =
  'grid grid-cols-[1.25rem_7rem_minmax(11rem,1fr)_5rem_minmax(13rem,1.2fr)_minmax(11rem,auto)_5.5rem_auto] items-center gap-x-3';

const BTN =
  'inline-flex items-center justify-center h-7 min-w-7 px-1.5 text-xs border border-zinc-700 text-zinc-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed';
const NO_LAUNCH = 'Aucune commande de lancement — configurer';

function Badge({ className, children, title }: { className: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`px-1 border text-[10px] leading-4 whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

function CrashBanner({ project }: { project: ProjectView }) {
  const crash = project.lastCrash;
  const [open, setOpen] = useState(project.status === 'failed');
  if (!crash) return null;
  const code = crash.exitCode === null ? 'tué par signal' : `code ${crash.exitCode}`;
  return (
    <div className="border-l-2 border-l-red-600 bg-red-950/30 text-xs">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-1 text-left text-red-300 hover:bg-red-950/50"
      >
        <span className="text-[10px]">{open ? '▼' : '▶'}</span>
        <span className="font-bold">Dernier crash</span>
        <span>
          {code} · {new Date(crash.at).toLocaleTimeString('fr-FR')}
        </span>
        {project.restarts > 0 && <span className="text-red-400/70">· {project.restarts} relance(s)</span>}
      </button>
      {open && (
        <pre className="px-3 pb-2 pl-8 text-red-200/80 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
          {crash.tail.length > 0 ? crash.tail.map(stripAnsi).join('\n') : '(aucune sortie capturée)'}
        </pre>
      )}
    </div>
  );
}

function ProjectRow({
  project,
  checked,
  onToggle,
  onAction,
  onOpenLogs,
  onOpenConfig,
}: {
  project: ProjectView;
  checked: boolean;
  onToggle: () => void;
  onAction: (action: RowAction) => void;
  onOpenLogs: () => void;
  onOpenConfig: () => void;
}) {
  const { name, status, git, launch, busy } = project;
  const st = STATUS[status];
  const active = status === 'running' || status === 'restarting';
  const noLaunch = launch === null;

  return (
    <div className="border-b border-zinc-900">
      <div
        className={`${ROW_GRID} px-3 py-1.5 text-xs border-l-2 transition-colors hover:bg-zinc-900/50 ${
          checked ? 'bg-zinc-900/70 border-l-zinc-400' : 'border-l-transparent'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Sélectionner ${name}`}
          className="accent-zinc-300 cursor-pointer"
        />

        <span className={`flex items-center gap-2 ${st.text}`}>
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} aria-hidden />
          <span className="uppercase tracking-wider text-[11px]">{st.label}</span>
        </span>

        <span className="flex items-baseline gap-2 min-w-0">
          <span className="font-bold text-sm text-zinc-100 truncate" title={project.path}>
            {name}
          </span>
          {project.missing && <Badge className="border-red-800 text-red-400">dossier absent</Badge>}
          {project.restarts > 0 && (
            <span className="text-zinc-500 shrink-0" title="Relances automatiques">
              ↺{project.restarts}
            </span>
          )}
        </span>

        <span className="text-zinc-300 tabular-nums">{project.version ? `v${project.version}` : '—'}</span>

        <span className="flex items-baseline gap-2 min-w-0" title={git?.message}>
          {git ? (
            <>
              <span className="text-yellow-400 truncate">{git.branch}</span>
              <span className="text-zinc-500 shrink-0">{git.commit}</span>
            </>
          ) : (
            <span className="text-zinc-700">—</span>
          )}
        </span>

        <span className="flex items-center gap-1.5 flex-wrap">
          {git && git.dirtyFiles > 0 && (
            <Badge className="border-orange-700 text-orange-400">{git.dirtyFiles} modifiés</Badge>
          )}
          {git && git.stashCount > 0 && (
            <Badge className="border-zinc-600 text-zinc-300">{git.stashCount} stash</Badge>
          )}
          {git && git.ahead > 0 && (
            <span className="text-cyan-400" title={`${git.ahead} commit(s) en avance sur le distant`}>
              ⬆{git.ahead}
            </span>
          )}
          {git && git.behind > 0 && (
            <span className="text-cyan-400" title={`${git.behind} commit(s) de retard sur le distant`}>
              ⬇{git.behind}
            </span>
          )}
        </span>

        <span className="text-zinc-400 tabular-nums">{status === 'running' ? formatUptime(project.uptimeMs / 1000) : ''}</span>

        <span className="flex items-center gap-1 justify-end">
          <span title={noLaunch ? NO_LAUNCH : 'Démarrer'}>
            <button
              onClick={() => onAction('start')}
              disabled={noLaunch || active || busy}
              aria-label={`Démarrer ${name}`}
              className={`${BTN} enabled:hover:border-green-400 enabled:hover:text-green-400`}
            >
              ▶
            </button>
          </span>
          <button
            onClick={() => onAction('stop')}
            disabled={!active || busy}
            title="Arrêter"
            aria-label={`Arrêter ${name}`}
            className={`${BTN} enabled:hover:border-red-400 enabled:hover:text-red-400`}
          >
            ■
          </button>
          <span title={noLaunch ? NO_LAUNCH : 'Redémarrer'}>
            <button
              onClick={() => onAction('restart')}
              disabled={noLaunch || busy}
              aria-label={`Redémarrer ${name}`}
              className={`${BTN} enabled:hover:border-yellow-400 enabled:hover:text-yellow-400`}
            >
              ↺
            </button>
          </span>
          <button onClick={onOpenLogs} className={`${BTN} ml-1 enabled:hover:border-zinc-400`} aria-label={`Logs de ${name}`}>
            logs
          </button>
          <button onClick={onOpenConfig} className={`${BTN} enabled:hover:border-zinc-400`} aria-label={`Configuration de ${name}`}>
            config
          </button>
        </span>
      </div>
      <CrashBanner project={project} />
    </div>
  );
}

export default function ProjectTable({ projects, selected, onToggle, onToggleAll, onAction, onOpenLogs, onOpenConfig }: Props) {
  const names = projects.map((p) => p.name);
  const selectedCount = names.filter((n) => selected.has(n)).length;
  const allChecked = names.length > 0 && selectedCount === names.length;

  if (projects.length === 0) {
    return <p className="px-3 py-8 text-xs text-zinc-500">Aucun projet trouvé dans le dossier racine.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[68rem]">
        <div className={`${ROW_GRID} px-3 py-1.5 border-b border-zinc-800 border-l-2 border-l-transparent text-[10px] uppercase tracking-widest text-zinc-600`}>
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = selectedCount > 0 && !allChecked;
            }}
            onChange={() => onToggleAll(names, !allChecked)}
            aria-label="Tout sélectionner"
            className="accent-zinc-300 cursor-pointer"
          />
          <span>Statut</span>
          <span>Projet</span>
          <span>Version</span>
          <span>Branche</span>
          <span>Git</span>
          <span>Uptime</span>
          <span className="text-right">Actions</span>
        </div>
        {projects.map((p) => (
          <ProjectRow
            key={p.name}
            project={p}
            checked={selected.has(p.name)}
            onToggle={() => onToggle(p.name)}
            onAction={(action) => onAction([p.name], action)}
            onOpenLogs={() => onOpenLogs([p.name])}
            onOpenConfig={() => onOpenConfig(p.name)}
          />
        ))}
      </div>
    </div>
  );
}
