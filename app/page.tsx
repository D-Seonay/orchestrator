'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ProjectCard from '@/components/ProjectCard';
import ProjectRow from '@/components/ProjectRow';
import AddProjectModal from '@/components/AddProjectModal';
import DeleteProjectModal from '@/components/DeleteProjectModal';
import GroupBar from '@/components/GroupBar';
import type { AppStats, OrchestratorStatus } from '@/types';

type StatusFilter = 'all' | 'online' | 'stopped' | 'building' | 'error';
type ViewMode = 'grid' | 'list';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all',      label: 'ALL'      },
  { key: 'online',   label: 'ONLINE'   },
  { key: 'stopped',  label: 'STOPPED'  },
  { key: 'building', label: 'BUILDING' },
  { key: 'error',    label: 'ERROR'    },
];

function hasErrors(app: AppStats): boolean {
  return app.logs.some(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('stderr'));
}

export default function DashboardPage() {
  const [apps, setApps] = useState<AppStats[]>([]);
  const [masterUptime, setMasterUptime] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const prevRestarts = useRef(new Map<string, number>());
  const prevStatuses = useRef(new Map<string, string>());

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/sse');
    es.onmessage = (e) => {
      const data: OrchestratorStatus = JSON.parse(e.data);
      data.apps.forEach((app: AppStats) => {
        const prevStatus = prevStatuses.current.get(app.name);
        const prevR = prevRestarts.current.get(app.name) ?? app.restarts;
        const wasRunning = prevStatus === 'Online' || prevStatus === 'Building';
        if (wasRunning && app.restarts > prevR && app.shouldRun) {
          if (Notification.permission === 'granted') {
            new Notification(`⚠️ ${app.name} a crashé`, {
              body: `Tentative de redémarrage... (restart #${app.restarts})`,
            });
          }
        }
        prevStatuses.current.set(app.name, app.status);
        prevRestarts.current.set(app.name, app.restarts);
      });
      setApps(data.apps);
      setMasterUptime(data.masterUptime);
      setIsLoaded(true);
    };
    return () => es.close();
  }, []);

  // Filtered + searched apps
  const filteredApps = apps.filter(app => {
    if (search && !app.name.toLowerCase().includes(search.toLowerCase())) return false;
    switch (statusFilter) {
      case 'online':   return app.status === 'Online';
      case 'stopped':  return app.status === 'Stopped';
      case 'building': return app.status === 'Building';
      case 'error':    return hasErrors(app);
      default:         return true;
    }
  });

  // Keyboard shortcuts
  const handleAction = useCallback(async (name: string, action: 'start' | 'stop' | 'restart' | 'gitpull') => {
    const res = await fetch(`/api/apps/${encodeURIComponent(name)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) console.error(`Action ${action} failed for ${name}`);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const focused = filteredApps[focusedIndex];
      if (!focused) return;

      switch (e.key) {
        case 'r': case 'R': e.preventDefault(); handleAction(focused.name, 'restart'); break;
        case 's': case 'S': e.preventDefault(); handleAction(focused.name, 'stop'); break;
        case 'l': case 'L': e.preventDefault(); break; // LogModal handled via ProjectCard/Row
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex(i => Math.min(i + 1, filteredApps.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex(i => Math.max(i - 1, 0));
          break;
        case 'Escape':
          setSearch('');
          searchRef.current?.blur();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filteredApps, focusedIndex, handleAction]);

  const handleGroupAction = async (group: string, action: 'start' | 'stop' | 'restart') => {
    await fetch(`/api/groups/${encodeURIComponent(group)}/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  };

  const handleUpdate = async (name: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/apps/${encodeURIComponent(name)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) console.error(`Update failed for ${name}`);
  };

  const handleDelete = async (name: string) => {
    await fetch(`/api/apps/${encodeURIComponent(name)}`, { method: 'DELETE' });
    setProjectToDelete(null);
  };

  const handleAdd = async (data: {
    name: string;
    type: 'node' | 'docker';
    script: string;
    args: string[];
    cwd: string;
    ports?: string[];
    autoStart?: boolean;
    env?: Record<string, string>;
  }) => {
    const res = await fetch('/api/apps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Failed to add project');
    }
    setIsModalOpen(false);
  };


  // Group filtered apps
  const groupMap = new Map<string, AppStats[]>();
  filteredApps.forEach(app => {
    const key = app.group || '';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(app);
  });
  const sortedGroups = [...groupMap.entries()].sort(([a], [b]) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b);
  });

  const counts: Record<StatusFilter, number> = {
    all:      apps.length,
    online:   apps.filter(a => a.status === 'Online').length,
    stopped:  apps.filter(a => a.status === 'Stopped').length,
    building: apps.filter(a => a.status === 'Building').length,
    error:    apps.filter(hasErrors).length,
  };

  // Flat index into filteredApps for keyboard nav
  let globalIdx = 0;

  return (
    <div className="p-6 min-h-screen">
      {/* Header */}
      <header className="flex items-start justify-between mb-6">
        <div>
          <motion.h1
            className="text-3xl font-bold tracking-tighter uppercase leading-tight"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            ORCHESTRATOR<br />PRO_DASHBOARD
          </motion.h1>
          {masterUptime && <span className="text-zinc-500 text-xs mt-1 block">UPTIME // {masterUptime}</span>}
        </div>
        <motion.button
          onClick={() => setIsModalOpen(true)}
          className="border border-zinc-700 px-4 py-2 text-sm uppercase tracking-widest hover:border-white hover:text-white transition-colors text-zinc-400"
          whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
        >
          + DEPLOY
        </motion.button>
      </header>

      {/* Toolbar: filters + search + view toggle */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {/* Status filters */}
        {FILTERS.map(({ key, label }) => {
          const count = counts[key];
          const active = statusFilter === key;
          const isError = key === 'error';
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`text-xs px-3 py-1 border transition-colors uppercase tracking-widest ${
                active
                  ? isError && count > 0 ? 'border-red-600 text-red-400 bg-red-950/20' : 'border-zinc-400 text-white'
                  : isError && count > 0 ? 'border-zinc-800 text-red-500 hover:border-red-600'
                  : 'border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400'
              }`}
            >
              {label}{count > 0 && count < counts.all ? ` (${count})` : ''}
            </button>
          );
        })}

        {/* Search */}
        <div className="flex items-center border border-zinc-800 focus-within:border-zinc-500 transition-colors ml-2">
          <span className="text-zinc-600 text-xs px-2">/</span>
          <input
            ref={searchRef}
            type="text"
            placeholder="search..."
            value={search}
            onChange={e => { setSearch(e.target.value); setFocusedIndex(0); }}
            onKeyDown={e => e.key === 'Escape' && (setSearch(''), e.currentTarget.blur())}
            className="bg-transparent px-2 py-1 text-xs text-white placeholder-zinc-700 focus:outline-none w-32"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-zinc-600 hover:text-white px-2 text-xs transition-colors">×</button>
          )}
        </div>

        {/* View toggle */}
        <div className="flex border border-zinc-800 ml-auto">
          <button
            onClick={() => setViewMode('grid')}
            className={`text-xs px-3 py-1 transition-colors ${viewMode === 'grid' ? 'text-white bg-zinc-800' : 'text-zinc-600 hover:text-zinc-400'}`}
            title="Grid view"
          >
            ⊞
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`text-xs px-3 py-1 transition-colors ${viewMode === 'list' ? 'text-white bg-zinc-800' : 'text-zinc-600 hover:text-zinc-400'}`}
            title="List view"
          >
            ≡
          </button>
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="text-zinc-800 text-xs mb-4 hidden md:block">
        ↑↓ navigate · R restart · S stop · L logs · / search · Esc clear
      </div>

      {/* List view header */}
      {viewMode === 'list' && filteredApps.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1 border-b border-zinc-800 mb-1">
          <span className="text-zinc-700 text-xs w-4 shrink-0" />
          <span className="text-zinc-700 text-xs w-44 shrink-0 uppercase tracking-widest">Name</span>
          <span className="text-zinc-700 text-xs w-20 shrink-0 uppercase tracking-widest">Status</span>
          <span className="text-zinc-700 text-xs w-24 shrink-0 uppercase tracking-widest">Uptime</span>
          <span className="text-zinc-700 text-xs w-28 shrink-0 uppercase tracking-widest">CPU / RAM</span>
          <span className="text-zinc-700 text-xs w-24 shrink-0 uppercase tracking-widest">Branch</span>
          <span className="text-zinc-700 text-xs w-8 shrink-0" />
          <div className="flex-1" />
          <span className="text-zinc-700 text-xs uppercase tracking-widest">Actions</span>
        </div>
      )}

      {/* Groups + cards/rows */}
      <div className="flex flex-col gap-0">
        <AnimatePresence mode="popLayout">
          {sortedGroups.map(([groupName, groupApps]) => (
            <motion.div key={groupName || '__ungrouped'} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {groupName && viewMode === 'grid' && (
                <GroupBar name={groupName} apps={groupApps} onAction={action => handleGroupAction(groupName, action)} />
              )}
              {groupName && viewMode === 'list' && (
                <div className="flex items-center gap-2 px-3 py-1 mt-4 mb-1">
                  <span className="text-zinc-600 text-xs uppercase tracking-widest">{groupName}</span>
                  <div className="flex-1 border-t border-zinc-900" />
                  <button onClick={() => handleGroupAction(groupName, 'restart')} className="text-zinc-700 hover:text-yellow-400 text-xs transition-colors" title={`Restart all ${groupName}`}>↺</button>
                  <button onClick={() => handleGroupAction(groupName, 'stop')}    className="text-zinc-700 hover:text-red-400 text-xs transition-colors"    title={`Stop all ${groupName}`}>■</button>
                </div>
              )}
              {!groupName && sortedGroups.length > 1 && viewMode === 'grid' && (
                <div className="flex items-center gap-3 mb-3 mt-6">
                  <span className="text-zinc-700 text-xs uppercase tracking-widest">Other</span>
                  <div className="flex-1 border-t border-zinc-800" />
                </div>
              )}

              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-2">
                  <AnimatePresence mode="popLayout">
                    {groupApps.map(app => {
                      globalIdx++;
                      return (
                        <ProjectCard
                          key={app.name}
                          project={app}
                          onAction={action => handleAction(app.name, action)}
                          onUpdate={patch => handleUpdate(app.name, patch)}
                          onDelete={() => setProjectToDelete(app.name)}
                        />
                      );
                    })}
                  </AnimatePresence>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {groupApps.map(app => {
                    const idx = globalIdx++;
                    return (
                      <ProjectRow
                        key={app.name}
                        project={app}
                        focused={focusedIndex === idx}
                        onFocus={() => setFocusedIndex(idx)}
                        onAction={action => handleAction(app.name, action)}
                        onDelete={() => setProjectToDelete(app.name)}
                      />
                    );
                  })}
                </AnimatePresence>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoaded && filteredApps.length === 0 && (
          <p className="text-zinc-600 uppercase tracking-widest text-xs">
            {search ? `NO RESULTS FOR "${search}".` : statusFilter === 'all' ? 'NO PROJECTS FOUND. CLICK + DEPLOY TO START.' : `NO ${statusFilter.toUpperCase()} PROJECTS.`}
          </p>
        )}
      </div>

      <AddProjectModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onAdd={handleAdd} />
      <DeleteProjectModal 
        isOpen={!!projectToDelete} 
        onClose={() => setProjectToDelete(null)} 
        onConfirm={() => projectToDelete && handleDelete(projectToDelete)} 
        projectName={projectToDelete || ''} 
      />
    </div>
  );
}
