'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ProjectCard from '@/components/ProjectCard';
import AddProjectModal from '@/components/AddProjectModal';
import type { AppStats, OrchestratorStatus } from '@/types';

export default function DashboardPage() {
  const [apps, setApps] = useState<AppStats[]>([]);
  const [masterUptime, setMasterUptime] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/sse');
    es.onmessage = (e) => {
      const data: OrchestratorStatus = JSON.parse(e.data);
      setApps(data.apps);
      setMasterUptime(data.masterUptime);
      setIsLoaded(true);
    };
    return () => es.close();
  }, []);

  const handleAction = async (name: string, action: 'start' | 'stop' | 'restart') => {
    const res = await fetch(`/api/apps/${encodeURIComponent(name)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) console.error(`Action ${action} failed for ${name}`);
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

  return (
    <div className="p-6 min-h-screen">
      <header className="flex items-start justify-between mb-8">
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
            <span className="text-zinc-500 text-xs mt-1 block">
              UPTIME // {masterUptime}
            </span>
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {apps.map(app => (
            <ProjectCard
              key={app.name}
              project={app}
              onAction={action => handleAction(app.name, action)}
              onUpdate={patch => handleUpdate(app.name, patch)}
              onDelete={() => handleDelete(app.name)}
            />
          ))}
        </AnimatePresence>
        {isLoaded && apps.length === 0 && (
          <p className="text-zinc-600 uppercase tracking-widest text-xs col-span-full">
            NO PROJECTS FOUND. CLICK + DEPLOY TO START.
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
