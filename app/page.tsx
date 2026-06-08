'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ProjectCard from '@/components/ProjectCard';
import AddProjectModal from '@/components/AddProjectModal';
import GroupBar from '@/components/GroupBar';
import type { AppStats, OrchestratorStatus } from '@/types';

type StatusFilter = 'all' | 'online' | 'stopped' | 'building' | 'error';

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
  const [isLoaded, setIsLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Crash notification tracking
  const prevRestarts = useRef(new Map<string, number>());
  const prevStatuses = useRef(new Map<string, string>());

  // Request notification permission once
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/sse');
    es.onmessage = (e) => {
      const data: OrchestratorStatus = JSON.parse(e.data);

      // Crash detection
      data.apps.forEach((app: AppStats) => {
        const prevStatus = prevStatuses.current.get(app.name);
        const prevR = prevRestarts.current.get(app.name) ?? app.restarts;
        const wasRunning = prevStatus === 'Online' || prevStatus === 'Building';

        if (wasRunning && app.restarts > prevR && app.shouldRun) {
          if (typeof window !== 'undefined' && Notification.permission === 'granted') {
            new Notification(`⚠️ ${app.name} a crashé`, {
              body: `Le process s'est arrêté. Tentative de redémarrage... (restart #${app.restarts})`,
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

  const handleAction = async (name: string, action: 'start' | 'stop' | 'restart' | 'gitpull') => {
    const res = await fetch(`/api/apps/${encodeURIComponent(name)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) console.error(`Action ${action} failed for ${name}`);
  };

  const handleGroupAction = async (group: string, action: 'start' | 'stop' | 'restart') => {
    await fetch(`/api/groups/${encodeURIComponent(group)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  };

  const handleUpdate = async (name: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/apps/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) console.error(`Update failed for ${name}`);
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete ${name}?`)) return;
    const res = await fetch(`/api/apps/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) console.error(`Delete failed for ${name}`);
  };

  const handleAdd = async (data: { name: string; script: string; args: string[]; cwd: string }) => {
    const res = await fetch('/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to deploy');
    }
    setIsModalOpen(false);
  };

  // Filter apps
  const filteredApps = apps.filter(app => {
    switch (statusFilter) {
      case 'online':   return app.status === 'Online';
      case 'stopped':  return app.status === 'Stopped';
      case 'building': return app.status === 'Building';
      case 'error':    return hasErrors(app);
      default:         return true;
    }
  });

  // Group filtered apps: named groups first, then ungrouped
  const groupMap = new Map<string, AppStats[]>();
  filteredApps.forEach(app => {
    const key = app.group || '';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(app);
  });
  // Named groups first, ungrouped ('') last
  const sortedGroups = [...groupMap.entries()].sort(([a], [b]) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return a.localeCompare(b);
  });

  // Counts for filter badges
  const counts: Record<StatusFilter, number> = {
    all:      apps.length,
    online:   apps.filter(a => a.status === 'Online').length,
    stopped:  apps.filter(a => a.status === 'Stopped').length,
    building: apps.filter(a => a.status === 'Building').length,
    error:    apps.filter(hasErrors).length,
  };

  return (
    <div className="p-6 min-h-screen">
      {/* Header */}
      <header className="flex items-start justify-between mb-6">
        <div>
          <motion.h1
            className="text-3xl font-bold tracking-tighter uppercase leading-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          >
            ORCHESTRATOR<br />PRO_DASHBOARD
          </motion.h1>
          {masterUptime && (
            <span className="text-zinc-500 text-xs mt-1 block">UPTIME // {masterUptime}</span>
          )}
        </div>
        <motion.button
          onClick={() => setIsModalOpen(true)}
          className="border border-zinc-700 px-4 py-2 text-sm uppercase tracking-widest hover:border-white hover:text-white transition-colors text-zinc-400"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          + DEPLOY
        </motion.button>
      </header>

      {/* Filter bar */}
      <div className="flex items-center gap-1 mb-6 flex-wrap">
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
                  ? isError && count > 0
                    ? 'border-red-600 text-red-400 bg-red-950/20'
                    : 'border-zinc-400 text-white'
                  : isError && count > 0
                  ? 'border-zinc-800 text-red-500 hover:border-red-600'
                  : 'border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400'
              }`}
            >
              {label}{count > 0 && count < counts.all ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      {/* Groups + cards */}
      <div className="flex flex-col gap-0">
        <AnimatePresence mode="popLayout">
          {sortedGroups.map(([groupName, groupApps]) => (
            <motion.div
              key={groupName || '__ungrouped'}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {groupName && (
                <GroupBar
                  name={groupName}
                  apps={groupApps}
                  onAction={action => handleGroupAction(groupName, action)}
                />
              )}
              {!groupName && sortedGroups.length > 1 && (
                <div className="flex items-center gap-3 mb-3 mt-6">
                  <span className="text-zinc-700 text-xs uppercase tracking-widest">Other</span>
                  <div className="flex-1 border-t border-zinc-800" />
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-2">
                <AnimatePresence mode="popLayout">
                  {groupApps.map(app => (
                    <ProjectCard
                      key={app.name}
                      project={app}
                      onAction={action => handleAction(app.name, action)}
                      onUpdate={patch => handleUpdate(app.name, patch)}
                      onDelete={() => handleDelete(app.name)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoaded && filteredApps.length === 0 && (
          <p className="text-zinc-600 uppercase tracking-widest text-xs">
            {statusFilter === 'all'
              ? 'NO PROJECTS FOUND. CLICK + DEPLOY TO START.'
              : `NO ${statusFilter.toUpperCase()} PROJECTS.`}
          </p>
        )}
      </div>

      <AddProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={handleAdd}
      />
    </div>
  );
}
