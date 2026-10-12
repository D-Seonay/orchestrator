'use client';

import { motion } from 'framer-motion';
import type { AppStats } from '@/types';
import { useState } from 'react';
import { isErrorLog } from '@/lib/utils';

type ActionType = 'start' | 'stop' | 'restart' | 'gitpull';

interface Props {
  project: AppStats;
  focused: boolean;
  onAction: (action: ActionType) => void | Promise<void>;
  onDelete: () => void;
  onFocus: () => void;
  onOpenLogs: () => void;
}

const ROW_BTN =
  'inline-flex items-center justify-center h-7 min-w-7 px-1.5 text-xs border transition-colors disabled:opacity-40 disabled:cursor-wait';

function statusColor(status: string) {
  switch (status) {
    case 'Online':    return 'text-green-400';
    case 'Building':  return 'text-cyan-400';
    case 'Restarting':return 'text-yellow-400';
    case 'Crashed':   return 'text-red-500';
    default:          return 'text-red-400';
  }
}

export default function ProjectRow({ project, focused, onAction, onDelete, onFocus, onOpenLogs }: Props) {
  const [busy, setBusy] = useState<ActionType | null>(null);
  const errorCount = project.logs.filter(isErrorLog).length;

  const runAction = async (action: ActionType) => {
    onFocus();
    setBusy(action);
    try {
      await onAction(action);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        onClick={onFocus}
        className={`flex items-center gap-3 px-3 py-2 border-b border-zinc-800 hover:bg-zinc-900/50 transition-colors cursor-default min-w-[800px] ${
          focused ? 'bg-zinc-900/70 border-l-2 border-l-zinc-500' : 'border-l-2 border-l-transparent'
        }`}
      >
        {/* Status dot */}
        <span className={`text-xs shrink-0 ${statusColor(project.status)}`}>●</span>

        {/* Name */}
        <div className="flex items-center gap-2 w-44 shrink-0 overflow-hidden">
          <span className="text-[10px] px-1 border border-zinc-700 text-zinc-400 uppercase shrink-0">
            {project.type === 'docker' ? 'DOCK' : 'NODE'}
          </span>
          <span className="text-xs font-bold uppercase tracking-wider truncate">
            {project.name}
          </span>
        </div>

        {/* Status label */}
        <span className={`text-xs w-20 shrink-0 uppercase ${statusColor(project.status)}`}>
          {project.status}
        </span>

        {/* Uptime */}
        <span className="text-zinc-400 text-xs w-24 shrink-0">
          {project.uptime}
        </span>

        {/* CPU / RAM */}
        <span className="text-xs w-28 shrink-0">
          <span className="text-blue-400">{project.cpu}</span>
          <span className="text-zinc-500"> / </span>
          <span className="text-purple-400">{project.ram}</span>
        </span>

        {/* Branch */}
        <span className="text-yellow-400 text-xs w-24 truncate shrink-0">
          {project.git.branch}{project.git.dirty ? '*' : ''}
        </span>

        {/* Restarts */}
        <span className="text-zinc-400 text-xs w-8 text-right shrink-0">
          {project.restarts > 0 ? `↺${project.restarts}` : ''}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="flex gap-1 shrink-0">
          {project.status === 'Crashed' ? (
            <button
              onClick={e => { e.stopPropagation(); runAction('restart'); }}
              disabled={busy === 'restart'}
              className={`${ROW_BTN} border-red-800 px-2 text-red-400 hover:border-red-400 uppercase`}
              aria-label={`Réinitialiser et redémarrer ${project.name}`}
            >
              ⚡ RESET
            </button>
          ) : (
            <>
              <button onClick={e => { e.stopPropagation(); runAction('start'); }}   disabled={busy === 'start'}   className={`${ROW_BTN} border-zinc-700 text-zinc-300 hover:border-green-400 hover:text-green-400`} aria-label={`Démarrer ${project.name}`} title="Start">▶</button>
              <button onClick={e => { e.stopPropagation(); runAction('stop'); }}    disabled={busy === 'stop'}    className={`${ROW_BTN} border-zinc-700 text-zinc-300 hover:border-red-400 hover:text-red-400`} aria-label={`Arrêter ${project.name}`} title="Stop">■</button>
              <button onClick={e => { e.stopPropagation(); runAction('restart'); }} disabled={busy === 'restart'} className={`${ROW_BTN} border-zinc-700 text-zinc-300 hover:border-yellow-400 hover:text-yellow-400`} aria-label={`Redémarrer ${project.name}`} title="Restart">↺</button>
            </>
          )}
          <button
            onClick={e => { e.stopPropagation(); onFocus(); onOpenLogs(); }}
            className={`${ROW_BTN} ${errorCount > 0 ? 'border-red-800 text-red-400 hover:border-red-400' : 'border-zinc-700 text-zinc-300 hover:border-zinc-400 hover:text-white'}`}
            aria-label={`Voir les logs de ${project.name}${errorCount > 0 ? ` (${errorCount} erreurs)` : ''}`}
            title="Logs"
          >
            ≡{errorCount > 0 ? `⚠${errorCount}` : ''}
          </button>
          <span className="w-px self-stretch bg-zinc-800 mx-0.5" aria-hidden />
          <button onClick={e => { e.stopPropagation(); onDelete(); }} className={`${ROW_BTN} border-zinc-700 text-zinc-400 hover:border-red-600 hover:text-red-500`} aria-label={`Supprimer ${project.name}`} title="Delete">✕</button>
        </div>
      </motion.div>
    </>
  );
}
