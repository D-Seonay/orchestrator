'use client';

import { useState } from 'react';
import type { ProjectView, RunStatus } from '@/lib/types';
import { formatUptime, stripAnsi } from '@/lib/utils';
import { ICON_BTN, TAG } from './ui';

export type RowAction = 'start' | 'stop' | 'restart';

interface Props {
  projects: ProjectView[];
  selected: ReadonlySet<string>;
  onToggle: (name: string) => void;
  onToggleAll: (names: string[], checked: boolean) => void;
  onAction: (names: string[], action: RowAction) => void;
  onOpenLogs: (names: string[]) => void;
  onOpenConfig: (name: string) => void;
  onSwitchBranch: (names: string[]) => void;
}

const STATUS: Record<RunStatus, { label: string; dot: string; text: string }> = {
  running: { label: 'En cours', dot: 'bg-ok', text: 'text-ok-text' },
  restarting: { label: 'Redémarre', dot: 'bg-warn animate-pulse', text: 'text-warn' },
  failed: { label: 'En échec', dot: 'bg-danger', text: 'text-danger-text' },
  stopped: { label: 'Arrêté', dot: 'bg-idle', text: 'text-muted' },
};

// Colonnes alignées sur toutes les lignes : case, statut, nom, version, branche, indicateurs, uptime, actions.
export const ROW_GRID =
  'grid grid-cols-[1.25rem_7rem_minmax(11rem,1fr)_7.5rem_minmax(13rem,1.2fr)_14rem_5.5rem_12rem] items-center gap-x-3';

const NO_LAUNCH = 'Aucune commande de lancement — configurer';
const MISSING = "Dossier absent — seul l'arrêt est possible";

function Badge({ className, children, title }: { className: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`${TAG} ${className}`}>
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
    <div className="mx-2 mb-2 rounded-md bg-danger-soft text-[13px] text-danger-text">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
      >
        <span className="text-[10px]">{open ? '▼' : '▶'}</span>
        <span className="font-medium">Dernier crash</span>
        <span>
          {code} · {new Date(crash.at).toLocaleTimeString('fr-FR')}
        </span>
        {project.restarts > 0 && <span className="opacity-70">· {project.restarts} relance(s)</span>}
      </button>
      {open && (
        <pre className="px-3 pb-2 pl-8 font-mono text-xs text-ink-soft whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
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
  onSwitchBranch,
}: {
  project: ProjectView;
  checked: boolean;
  onToggle: () => void;
  onAction: (action: RowAction) => void;
  onOpenLogs: () => void;
  onOpenConfig: () => void;
  onSwitchBranch: () => void;
}) {
  const { name, status, git, launch, busy } = project;
  const st = STATUS[status];
  const active = status === 'running' || status === 'restarting';
  const noLaunch = launch === null;
  // Ni démarrage ni redémarrage pour un dossier absent : seul l'arrêt reste possible.
  const cannotLaunch = noLaunch || project.missing;
  const launchTitle = (label: string) => (project.missing ? MISSING : noLaunch ? NO_LAUNCH : label);

  return (
    <div className="border-b border-line-soft">
      <div className={`${ROW_GRID} px-2 py-2 text-[13px] rounded-md transition-colors ${checked ? 'bg-accent-soft' : 'hover:bg-hover'}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Sélectionner ${name}`}
          className="accent-accent cursor-pointer"
        />

        <span className={`flex items-center gap-2 ${st.text}`}>
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} aria-hidden />
          <span>{st.label}</span>
        </span>

        <span className="flex items-baseline gap-2 min-w-0">
          <span className="font-medium text-ink truncate" title={project.path}>
            {name}
          </span>
          {project.missing && <Badge className="bg-danger-soft text-danger-text">dossier absent</Badge>}
          {project.restarts > 0 && (
            <span className="text-muted shrink-0" title="Redémarrages">
              ↺{project.restarts}
            </span>
          )}
        </span>

        <span className="font-mono text-xs text-ink-soft">{project.version ? `v${project.version}` : '—'}</span>

        <span className="flex items-baseline gap-2 min-w-0" title={git?.message}>
          {git ? (
            <>
              <span className={`${TAG} bg-tag text-ink-soft truncate`}>{git.branch}</span>
              <span className="font-mono text-xs text-muted shrink-0">{git.commit}</span>
            </>
          ) : (
            <span className="text-muted">—</span>
          )}
        </span>

        <span className="flex items-center gap-1.5 flex-wrap">
          {git && git.dirtyFiles > 0 && (
            <Badge className="bg-note-soft text-note">{git.dirtyFiles} modifié{git.dirtyFiles > 1 ? 's' : ''}</Badge>
          )}
          {git && git.stashCount > 0 && (
            <Badge className="bg-tag text-ink-soft">{git.stashCount} stash</Badge>
          )}
          {git && git.ahead > 0 && (
            <span className="text-xs text-accent" title={`${git.ahead} commit(s) en avance sur le distant`}>
              ⬆{git.ahead}
            </span>
          )}
          {git && git.behind > 0 && (
            <span className="text-xs text-accent" title={`${git.behind} commit(s) de retard sur le distant`}>
              ⬇{git.behind}
            </span>
          )}
        </span>

        <span className="text-muted tabular-nums">{status === 'running' ? formatUptime(project.uptimeMs / 1000) : ''}</span>

        <span className="flex items-center gap-0.5 justify-end">
          <span title={launchTitle('Démarrer')}>
            <button
              onClick={() => onAction('start')}
              disabled={cannotLaunch || active || busy}
              aria-label={`Démarrer ${name}`}
              className={`${ICON_BTN} enabled:hover:text-ok-text`}
            >
              ▶
            </button>
          </span>
          <button
            onClick={() => onAction('stop')}
            disabled={!active || busy}
            title="Arrêter"
            aria-label={`Arrêter ${name}`}
            className={`${ICON_BTN} enabled:hover:text-danger-text`}
          >
            ■
          </button>
          <span title={launchTitle('Redémarrer')}>
            <button
              onClick={() => onAction('restart')}
              disabled={cannotLaunch || busy}
              aria-label={`Redémarrer ${name}`}
              className={ICON_BTN}
            >
              ↺
            </button>
          </span>
          <button onClick={onOpenLogs} className={`${ICON_BTN} ml-1`} title="Logs" aria-label={`Logs de ${name}`}>
            ≡
          </button>
          <button onClick={onOpenConfig} className={ICON_BTN} title="Configuration" aria-label={`Configuration de ${name}`}>
            ⚙
          </button>
          <button
            onClick={onSwitchBranch}
            disabled={!git || busy}
            title={git ? 'Changer de branche' : 'Pas un dépôt git'}
            aria-label={`Changer la branche de ${name}`}
            className={ICON_BTN}
          >
            ⎇
          </button>
        </span>
      </div>
      <CrashBanner project={project} />
    </div>
  );
}

export default function ProjectTable({ projects, selected, onToggle, onToggleAll, onAction, onOpenLogs, onOpenConfig, onSwitchBranch }: Props) {
  const names = projects.map((p) => p.name);
  const selectedCount = names.filter((n) => selected.has(n)).length;
  const allChecked = names.length > 0 && selectedCount === names.length;

  if (projects.length === 0) {
    return <p className="px-8 py-8 text-muted">Aucun projet trouvé dans le dossier racine.</p>;
  }

  return (
    <div className="overflow-x-auto px-6">
      <div className="min-w-[68rem]">
        <div className={`${ROW_GRID} px-2 py-1.5 border-b border-line text-xs text-muted`}>
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = selectedCount > 0 && !allChecked;
            }}
            onChange={() => onToggleAll(names, !allChecked)}
            aria-label="Tout sélectionner"
            className="accent-accent cursor-pointer"
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
            onSwitchBranch={() => onSwitchBranch([p.name])}
          />
        ))}
      </div>
    </div>
  );
}
