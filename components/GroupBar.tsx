'use client';

import type { AppStats } from '@/types';

interface Props {
  name: string;
  apps: AppStats[];
  onAction: (action: 'start' | 'stop' | 'restart') => void;
}

export default function GroupBar({ name, apps, onAction }: Props) {
  const online = apps.filter(a => a.status === 'Online' || a.status === 'Building').length;
  const total = apps.length;

  return (
    <div className="flex items-center gap-3 mb-3 mt-6 first:mt-0">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500 text-xs uppercase tracking-widest">
          {name}
        </span>
        <span className="text-zinc-700 text-xs">{online}/{total}</span>
      </div>
      <div className="flex-1 border-t border-zinc-800" />
      <div className="flex gap-1">
        <button
          onClick={() => onAction('start')}
          className="text-xs border border-zinc-800 px-2 py-0.5 hover:border-green-400 hover:text-green-400 transition-colors text-zinc-600"
          title={`Start all ${name}`}
        >
          ▶ ALL
        </button>
        <button
          onClick={() => onAction('stop')}
          className="text-xs border border-zinc-800 px-2 py-0.5 hover:border-red-400 hover:text-red-400 transition-colors text-zinc-600"
          title={`Stop all ${name}`}
        >
          ■ ALL
        </button>
        <button
          onClick={() => onAction('restart')}
          className="text-xs border border-zinc-800 px-2 py-0.5 hover:border-yellow-400 hover:text-yellow-400 transition-colors text-zinc-600"
          title={`Restart all ${name}`}
        >
          ↺ ALL
        </button>
      </div>
    </div>
  );
}
