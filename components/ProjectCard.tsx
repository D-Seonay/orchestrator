'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import type { AppStats } from '@/types';

interface Props {
  project: AppStats;
  onAction: (action: 'start' | 'stop' | 'restart') => void;
  onUpdate: (patch: { script?: string; args?: string[]; cwd?: string }) => void;
  onDelete: () => void;
}

export default function ProjectCard({ project, onAction, onUpdate, onDelete }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    script: project.script || '',
    args: (Array.isArray(project.args) ? project.args : project.args ? [project.args] : []).join(' '),
    cwd: project.cwd || '',
  });

  const isOnline = project.status === 'Online';
  const statusColor = isOnline
    ? 'text-green-400'
    : project.status === 'Restarting'
    ? 'text-yellow-400'
    : 'text-red-400';

  const handleSave = () => {
    onUpdate({
      script: editData.script,
      args: editData.args.split(' ').filter(Boolean),
      cwd: editData.cwd,
    });
    setIsEditing(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="border border-zinc-800 hover:border-zinc-600 transition-colors p-4 flex flex-col gap-3 bg-zinc-950"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm uppercase tracking-wider truncate max-w-[60%]">
          {project.name}
        </h2>
        <motion.span
          className={`text-xs uppercase ${statusColor}`}
          animate={isOnline ? { opacity: [0.5, 1, 0.5] } : { opacity: 1 }}
          transition={isOnline ? { repeat: Infinity, duration: 3 } : {}}
        >
          ● {project.status}
        </motion.span>
      </div>

      {/* Body */}
      <div
        className="flex flex-col gap-1 cursor-pointer"
        onClick={() => { if (!isEditing) setIsEditing(true); }}
        onKeyDown={(e) => {
          if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setIsEditing(true);
          }
        }}
        tabIndex={isEditing ? -1 : 0}
        role={isEditing ? undefined : 'button'}
        aria-label={`Edit ${project.name}`}
      >
        {isEditing ? (
          <div className="flex flex-col gap-2" onClick={e => e.stopPropagation()}>
            {(
              [
                { label: 'SCRIPT', key: 'script' as const },
                { label: 'ARGS', key: 'args' as const },
                { label: 'CWD', key: 'cwd' as const },
              ] as const
            ).map(({ label, key }) => (
              <div key={key}>
                <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">
                  {label}
                </label>
                <input
                  className="w-full bg-black border border-zinc-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-400"
                  value={editData[key]}
                  onChange={e => setEditData({ ...editData, [key]: e.target.value })}
                />
              </div>
            ))}
            <div className="flex gap-2 mt-1">
              <button
                onClick={handleSave}
                className="text-xs border border-zinc-600 px-3 py-1 hover:border-white hover:text-white transition-colors uppercase"
              >
                SAVE
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="text-xs text-zinc-500 hover:text-white transition-colors uppercase"
              >
                CANCEL
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500 text-xs uppercase tracking-widest shrink-0">LAUNCH_SCRIPT</span>
              <span className="text-xs text-zinc-300 truncate">{project.script || 'N/A'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500 text-xs uppercase tracking-widest shrink-0">WORKING_DIR</span>
              <span className="text-xs text-zinc-300 truncate">{project.cwd || './'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500 text-xs uppercase tracking-widest shrink-0">BRANCH</span>
              <span className="text-xs text-yellow-400">
                {project.git.branch}
                {project.git.dirty ? '*' : ''}
                {project.git.sync ? ` ${project.git.sync}` : ''}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Stats */}
      <div className="border-t border-zinc-800 pt-3 grid grid-cols-3 gap-2">
        <div>
          <div className="text-zinc-500 text-xs uppercase tracking-widest">CPU</div>
          <div className="text-xs text-blue-400">{project.cpu}</div>
        </div>
        <div>
          <div className="text-zinc-500 text-xs uppercase tracking-widest">RAM</div>
          <div className="text-xs text-purple-400">{project.ram}</div>
        </div>
        <div>
          <div className="text-zinc-500 text-xs uppercase tracking-widest">RESTARTS</div>
          <div className="text-xs text-zinc-300">{project.restarts}</div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-zinc-600 text-xs">UPTIME // {project.uptime}</span>
        <div className="flex gap-1">
          <button
            onClick={() => onAction('start')}
            className="text-xs border border-zinc-800 px-2 py-1 hover:border-green-400 hover:text-green-400 transition-colors"
            title="Start"
          >
            ▶
          </button>
          <button
            onClick={() => onAction('stop')}
            className="text-xs border border-zinc-800 px-2 py-1 hover:border-red-400 hover:text-red-400 transition-colors"
            title="Stop"
          >
            ■
          </button>
          <button
            onClick={() => onAction('restart')}
            className="text-xs border border-zinc-800 px-2 py-1 hover:border-yellow-400 hover:text-yellow-400 transition-colors"
            title="Restart"
          >
            ↺
          </button>
          <button
            onClick={onDelete}
            className="text-xs border border-zinc-800 px-2 py-1 hover:border-red-600 hover:text-red-600 transition-colors"
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>
    </motion.div>
  );
}
