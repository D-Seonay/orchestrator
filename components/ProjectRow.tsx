'use client';

import { motion } from 'framer-motion';
import type { AppStats } from '@/types';
import LogModal from '@/components/LogModal';
import { useState } from 'react';
import { isErrorLog } from '@/lib/utils';

interface Props {
  project: AppStats;
  focused: boolean;
  onAction: (action: 'start' | 'stop' | 'restart' | 'gitpull') => void;
  onDelete: () => void;
  onFocus: () => void;
}

function statusColor(status: string) {
  switch (status) {
    case 'Online':    return 'text-green-400';
    case 'Building':  return 'text-cyan-400';
    case 'Restarting':return 'text-yellow-400';
    case 'Crashed':   return 'text-red-500';
    default:          return 'text-red-400';
  }
}

export default function ProjectRow({ project, focused, onAction, onDelete, onFocus }: Props) {
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const errorCount = project.logs.filter(isErrorLog).length;

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        onClick={onFocus}
        className={`flex items-center gap-3 px-3 py-2 border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors cursor-default ${
          focused ? 'bg-zinc-900/70 border-l-2 border-l-zinc-500' : 'border-l-2 border-l-transparent'
        }`}
      >
        {/* Status dot */}
        <span className={`text-xs shrink-0 ${statusColor(project.status)}`}>●</span>

        {/* Name */}
        <div className="flex items-center gap-2 w-44 shrink-0 overflow-hidden">
          <span className="text-[9px] px-1 border border-zinc-800 text-zinc-600 uppercase shrink-0">
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
        <span className="text-zinc-600 text-xs w-24 shrink-0">
          {project.uptime}
        </span>

        {/* CPU / RAM */}
        <span className="text-xs w-28 shrink-0">
          <span className="text-blue-400">{project.cpu}</span>
          <span className="text-zinc-700"> / </span>
          <span className="text-purple-400">{project.ram}</span>
        </span>

        {/* Branch */}
        <span className="text-yellow-400 text-xs w-24 truncate shrink-0">
          {project.git.branch}{project.git.dirty ? '*' : ''}
        </span>

        {/* Restarts */}
        <span className="text-zinc-600 text-xs w-8 text-right shrink-0">
          {project.restarts > 0 ? `↺${project.restarts}` : ''}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="flex gap-1 shrink-0">
          {project.status === 'Crashed' ? (
            <button
              onClick={e => { e.stopPropagation(); onAction('restart'); }}
              className="text-xs border border-red-800 px-2 py-0.5 text-red-400 hover:border-red-400 transition-colors uppercase"
            >
              ⚡ RESET
            </button>
          ) : (
            <>
              <button onClick={e => { e.stopPropagation(); onAction('start'); }}   className="text-xs border border-zinc-800 px-1.5 py-0.5 hover:border-green-400 hover:text-green-400 transition-colors text-zinc-600" title="Start">▶</button>
              <button onClick={e => { e.stopPropagation(); onAction('stop'); }}    className="text-xs border border-zinc-800 px-1.5 py-0.5 hover:border-red-400 hover:text-red-400 transition-colors text-zinc-600" title="Stop">■</button>
              <button onClick={e => { e.stopPropagation(); onAction('restart'); }} className="text-xs border border-zinc-800 px-1.5 py-0.5 hover:border-yellow-400 hover:text-yellow-400 transition-colors text-zinc-600" title="Restart">↺</button>
            </>
          )}
          <button
            onClick={e => { e.stopPropagation(); setIsLogsOpen(true); }}
            className={`text-xs border border-zinc-800 px-1.5 py-0.5 transition-colors ${errorCount > 0 ? 'text-red-500 hover:border-red-400' : 'text-zinc-600 hover:border-zinc-500'}`}
            title="Logs"
          >
            ≡{errorCount > 0 ? `⚠${errorCount}` : ''}
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(); }} className="text-xs border border-zinc-800 px-1.5 py-0.5 hover:border-red-600 hover:text-red-600 transition-colors text-zinc-700" title="Delete">✕</button>
        </div>
      </motion.div>

      <LogModal appName={project.name} logs={project.logs} isOpen={isLogsOpen} onClose={() => setIsLogsOpen(false)} />
    </>
  );
}
