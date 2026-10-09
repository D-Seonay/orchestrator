'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { isErrorLog } from '@/lib/utils';

interface Props {
  appName: string;
  logs: string[];
  isOpen: boolean;
  onClose: () => void;
}

function lineColor(line: string): string {
  const l = line.toLowerCase();
  if (isErrorLog(line)) return 'text-red-400';
  if (l.includes('debug:')) return 'text-zinc-500';
  if (l.includes('warn')) return 'text-yellow-400';
  if (l.includes('✔') || l.includes('compiled successfully') || l.includes('success')) return 'text-green-400';
  if (l.includes('building') || l.includes('compiling')) return 'text-cyan-400';
  if (l.includes('note:') || l.includes('info')) return 'text-blue-400';
  return 'text-zinc-300';
}

export default function LogModal({ appName, logs, isOpen, onClose }: Props) {
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = logs.filter(line => {
    if (showErrorsOnly && !isErrorLog(line)) return false;
    if (filter && !line.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  useEffect(() => {
    if (autoScroll && isOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isOpen]);

  // Detect manual scroll up → disable auto-scroll
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (!atBottom) setAutoScroll(false);
    else setAutoScroll(true);
  };

  const errorCount = logs.filter(isErrorLog).length;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="log-backdrop"
            className="fixed inset-0 bg-black/90 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            key="log-modal"
            className="fixed inset-4 md:inset-8 z-50 bg-zinc-950 border border-zinc-700 flex flex-col"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.15 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
              <div className="flex items-center gap-4">
                <h2 className="text-sm font-bold uppercase tracking-widest">{appName} — LOGS</h2>
                <span className="text-zinc-600 text-xs">{filtered.length}/{logs.length} lignes</span>
                {errorCount > 0 && (
                  <span className="text-red-400 text-xs">{errorCount} erreur{errorCount > 1 ? 's' : ''}</span>
                )}
              </div>
              <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors text-lg leading-none">×</button>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 shrink-0">
              <input
                type="text"
                placeholder="Filtrer..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="flex-1 bg-black border border-zinc-700 px-3 py-1 text-xs text-white placeholder-zinc-700 focus:outline-none focus:border-zinc-400"
              />
              <button
                onClick={() => setShowErrorsOnly(v => !v)}
                className={`text-xs border px-3 py-1 transition-colors uppercase ${
                  showErrorsOnly
                    ? 'border-red-600 text-red-400'
                    : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                }`}
              >
                Errors only
              </button>
              <button
                onClick={() => setAutoScroll(v => !v)}
                className={`text-xs border px-3 py-1 transition-colors uppercase ${
                  autoScroll
                    ? 'border-green-700 text-green-400'
                    : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                }`}
              >
                Auto-scroll {autoScroll ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* Log lines */}
            <div
              ref={containerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 flex flex-col gap-0.5"
            >
              {filtered.length === 0 ? (
                <span className="text-zinc-700 text-xs italic">
                  {logs.length === 0 ? 'Pas encore de logs.' : 'Aucun résultat pour ce filtre.'}
                </span>
              ) : (
                filtered.map((line, i) => (
                  <div key={i} className={`text-xs leading-relaxed whitespace-pre-wrap break-all font-mono ${lineColor(line)}`}>
                    {line}
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-800 shrink-0">
              <span className="text-zinc-700 text-xs">100 lignes max (circular buffer)</span>
              <button
                onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="text-xs text-zinc-500 hover:text-white transition-colors uppercase"
              >
                ↓ Bas
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
