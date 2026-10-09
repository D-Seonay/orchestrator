'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import type { AppStats } from '@/types';
import EnvFileModal from '@/components/EnvFileModal';
import LogModal from '@/components/LogModal';

interface Props {
  project: AppStats;
  onAction: (action: 'start' | 'stop' | 'restart' | 'gitpull') => void;
  onUpdate: (patch: {
    script?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    ports?: string[];
  }) => void;
  onDelete: () => void;
}

export default function ProjectCard({ project, onAction, onUpdate, onDelete }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [isEnvOpen, setIsEnvOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);

  const [editData, setEditData] = useState({
    script: project.script || '',
    args: (Array.isArray(project.args) ? project.args : project.args ? [project.args] : []).join(' '),
    cwd: project.cwd || '',
    ports: (project.ports || []).join(', '),
    language: (project.env?.OPTION === '1' ? 'fr' : project.env?.OPTION === '2' ? 'en' : project.env?.OPTION === '3' ? 'es' : '') as '' | 'fr' | 'en' | 'es',
  });
  const [envEntries, setEnvEntries] = useState<{ key: string; value: string }[]>(
    Object.entries(project.env || {}).map(([k, v]) => ({ key: k, value: v }))
  );

  const isOnline = project.status === 'Online';
  const isBuilding = project.status === 'Building';
  const isCrashed = project.status === 'Crashed';
  const statusColor =
    isOnline ? 'text-green-400'
    : isBuilding ? 'text-cyan-400'
    : project.status === 'Restarting' ? 'text-yellow-400'
    : isCrashed ? 'text-red-500'
    : 'text-red-400';

  const envCount = Object.keys(project.env || {}).length;
  const errorCount = project.logs.filter(l => l.includes('ERROR')).length;

  const handleSave = () => {
    const env = Object.fromEntries(
      envEntries.filter(e => e.key.trim() !== '').map(e => [e.key.trim(), e.value])
    );

    // Apply language selection to env
    if (editData.language) {
      env.OPTION = editData.language === 'fr' ? '1' : editData.language === 'en' ? '2' : '3';
    } else if (env.OPTION === '1' || env.OPTION === '2' || env.OPTION === '3') {
      // If language was cleared, remove the mapped OPTION if it matches one of our presets
      delete env.OPTION;
    }

    onUpdate({
      script: editData.script,
      args: editData.args.split(' ').filter(Boolean),
      cwd: editData.cwd,
      env,
      ports: editData.ports.split(',').map(p => p.trim()).filter(Boolean),
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditData({
      script: project.script || '',
      args: (Array.isArray(project.args) ? project.args : project.args ? [project.args] : []).join(' '),
      cwd: project.cwd || '',
      ports: (project.ports || []).join(', '),
      language: (project.env?.OPTION === '1' ? 'fr' : project.env?.OPTION === '2' ? 'en' : project.env?.OPTION === '3' ? 'es' : '') as '' | 'fr' | 'en' | 'es',
    });
    setEnvEntries(Object.entries(project.env || {}).map(([k, v]) => ({ key: k, value: v })));
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
        <div className="flex items-center gap-2 truncate max-w-[60%]">
          <span className="text-[10px] px-1 border border-zinc-700 text-zinc-500 uppercase">
            {project.type === 'docker' ? 'DOCKER' : 'NODE'}
          </span>
          <h2 className="font-bold text-sm uppercase tracking-wider truncate">
            {project.name}
          </h2>
        </div>
        <motion.span
          className={`text-xs uppercase ${statusColor}`}
          animate={(isOnline || isBuilding) ? { opacity: [0.5, 1, 0.5] } : isCrashed ? { opacity: 1 } : { opacity: 1 }}
          transition={(isOnline || isBuilding) ? { repeat: Infinity, duration: isBuilding ? 1 : 3 } : {}}
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
            <div>
              <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">
                {project.type === 'docker' ? 'DOCKERFILE' : 'SCRIPT'}
              </label>
              <input
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-400"
                value={editData.script}
                onChange={e => setEditData({ ...editData, script: e.target.value })}
              />
            </div>

            {project.type === 'node' ? (
              <div>
                <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">ARGS</label>
                <input
                  className="w-full bg-black border border-zinc-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-400"
                  value={editData.args}
                  onChange={e => setEditData({ ...editData, args: e.target.value })}
                />
              </div>
            ) : (
              <div>
                <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">PORTS</label>
                <input
                  className="w-full bg-black border border-zinc-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-400"
                  value={editData.ports}
                  onChange={e => setEditData({ ...editData, ports: e.target.value })}
                />
              </div>
            )}

            <div>
              <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">CWD</label>
              <input
                className="w-full bg-black border border-zinc-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-400"
                value={editData.cwd}
                onChange={e => setEditData({ ...editData, cwd: e.target.value })}
              />
            </div>

            {/* Language Selection */}
            <div>
              <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">DATABASE_LANGUAGE</label>
              <div className="flex gap-1">
                {[
                  { label: 'FR', value: 'fr' as const },
                  { label: 'EN', value: 'en' as const },
                  { label: 'ES', value: 'es' as const },
                ].map(lang => (
                  <button
                    key={lang.value}
                    type="button"
                    onClick={() => setEditData({ ...editData, language: editData.language === lang.value ? '' : lang.value })}
                    className={`flex-1 px-1 py-1 text-[9px] uppercase tracking-tighter border ${
                      editData.language === lang.value ? 'bg-zinc-100 text-black border-white' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ENV VARIABLES */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-zinc-500 text-xs uppercase tracking-widest">ENV_VARS</label>
                <button
                  onClick={() => setEnvEntries([...envEntries, { key: '', value: '' }])}
                  className="text-xs text-zinc-500 hover:text-white transition-colors"
                >
                  + ADD
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {envEntries.map((entry, i) => (
                  <div key={i} className="flex gap-1 items-center">
                    <input
                      placeholder="KEY"
                      className="w-2/5 bg-black border border-zinc-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-400 placeholder-zinc-700"
                      value={entry.key}
                      onChange={e => {
                        const next = [...envEntries];
                        next[i] = { ...next[i], key: e.target.value };
                        setEnvEntries(next);
                      }}
                    />
                    <span className="text-zinc-600 text-xs">=</span>
                    <input
                      placeholder="value"
                      className="flex-1 bg-black border border-zinc-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-400 placeholder-zinc-700"
                      value={entry.value}
                      onChange={e => {
                        const next = [...envEntries];
                        next[i] = { ...next[i], value: e.target.value };
                        setEnvEntries(next);
                      }}
                    />
                    <button
                      onClick={() => setEnvEntries(envEntries.filter((_, j) => j !== i))}
                      className="text-zinc-600 hover:text-red-400 transition-colors text-xs px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {envEntries.length === 0 && (
                  <span className="text-zinc-700 text-xs italic">no env vars</span>
                )}
              </div>
            </div>

            <div className="flex gap-2 mt-1">
              <button onClick={handleSave} className="text-xs border border-zinc-600 px-3 py-1 hover:border-white hover:text-white transition-colors uppercase">SAVE</button>
              <button onClick={handleCancel} className="text-xs text-zinc-500 hover:text-white transition-colors uppercase">CANCEL</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-between gap-2">
              <span className="text-zinc-500 text-xs uppercase tracking-widest shrink-0">
                {project.type === 'docker' ? 'DOCKERFILE' : 'LAUNCH_SCRIPT'}
              </span>
              <span className="text-xs text-zinc-300 truncate">{project.script || (project.type === 'docker' ? 'Dockerfile' : 'N/A')}</span>
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
            {envCount > 0 && (
              <div className="flex justify-between gap-2">
                <span className="text-zinc-500 text-xs uppercase tracking-widest shrink-0">ENV_VARS</span>
                <span className="text-xs text-zinc-500">{envCount} var{envCount > 1 ? 's' : ''}</span>
              </div>
            )}
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

      {/* Circuit breaker banner */}
      {isCrashed && (
        <div className="border border-red-900 bg-red-950/30 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-red-400 text-xs">⚡ Circuit ouvert — 5 crashes en 60s</span>
          <button
            onClick={() => onAction('restart')}
            className="text-xs border border-red-700 px-3 py-1 text-red-400 hover:border-red-400 hover:text-white transition-colors uppercase shrink-0"
          >
            RESET
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-zinc-600 text-xs">UPTIME // {project.uptime}</span>
        <div className="flex gap-1">
          <button
            onClick={() => setIsLogsOpen(true)}
            className={`text-xs border px-2 py-1 transition-colors ${
              errorCount > 0
                ? 'border-zinc-800 text-red-500 hover:border-red-400'
                : 'border-zinc-800 text-zinc-600 hover:border-zinc-400 hover:text-zinc-300'
            }`}
            title="Voir les logs"
          >
            LOGS{errorCount > 0 ? ` ⚠${errorCount}` : ''}
          </button>
          {project.cwd && (
            <button
              onClick={() => onAction('gitpull')}
              className="text-xs border border-zinc-800 px-2 py-1 hover:border-blue-400 hover:text-blue-400 transition-colors text-zinc-600"
              title="Git pull + restart"
            >
              ⬇ pull
            </button>
          )}
          <button
            onClick={() => setIsEnvOpen(true)}
            className="text-xs border border-zinc-800 px-2 py-1 hover:border-zinc-400 hover:text-zinc-300 transition-colors text-zinc-600"
            title="Edit .env file"
          >
            .env
          </button>
          <button onClick={() => onAction('start')} className="text-xs border border-zinc-800 px-2 py-1 hover:border-green-400 hover:text-green-400 transition-colors" title="Start">▶</button>
          <button onClick={() => onAction('stop')} className="text-xs border border-zinc-800 px-2 py-1 hover:border-red-400 hover:text-red-400 transition-colors" title="Stop">■</button>
          <button onClick={() => onAction('restart')} className="text-xs border border-zinc-800 px-2 py-1 hover:border-yellow-400 hover:text-yellow-400 transition-colors" title="Restart">↺</button>
          <button onClick={onDelete} className="text-xs border border-zinc-800 px-2 py-1 hover:border-red-600 hover:text-red-600 transition-colors" title="Delete">✕</button>
        </div>
      </div>

      <EnvFileModal
        appName={project.name}
        isOpen={isEnvOpen}
        onClose={() => setIsEnvOpen(false)}
      />
      <LogModal
        appName={project.name}
        logs={project.logs}
        isOpen={isLogsOpen}
        onClose={() => setIsLogsOpen(false)}
      />
    </motion.div>
  );
}
