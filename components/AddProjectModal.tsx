'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: { name: string; script: string; args: string[]; cwd: string }) => Promise<void>;
}

type ValidationState = 'idle' | 'checking' | 'ok' | 'error';

function usePathValidation(path: string, debounceMs = 600): ValidationState {
  const [state, setState] = useState<ValidationState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!path.trim()) { setState('idle'); return; }
    setState('checking');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/validate-path?path=${encodeURIComponent(path)}`);
        setState(res.ok ? 'ok' : 'error');
      } catch {
        setState('error');
      }
    }, debounceMs);
    return () => clearTimeout(timer.current as ReturnType<typeof setTimeout>);
  }, [path, debounceMs]);

  return state;
}

function ValidationIndicator({ state }: { state: ValidationState }) {
  if (state === 'idle') return null;
  if (state === 'checking') return <span className="text-zinc-600 text-xs">...</span>;
  if (state === 'ok') return <span className="text-green-400 text-xs">✓</span>;
  return <span className="text-red-400 text-xs">✗ not found</span>;
}

export default function AddProjectModal({ isOpen, onClose, onAdd }: Props) {
  const [formData, setFormData] = useState({ name: '', script: '', args: '', cwd: '' });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cwdValidation = usePathValidation(formData.cwd);
  // Validate script relative to cwd (or absolute)
  const scriptPath = formData.cwd && formData.script
    ? `${formData.cwd}/${formData.script}`
    : formData.script;
  const scriptValidation = usePathValidation(scriptPath);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await onAdd({
        name: formData.name,
        script: formData.script,
        args: formData.args.split(' ').filter(Boolean),
        cwd: formData.cwd,
      });
      setFormData({ name: '', script: '', args: '', cwd: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="backdrop"
          className="fixed inset-0 bg-black/80 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
      )}
      {isOpen && (
        <motion.div
          key="modal"
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-zinc-950 border border-zinc-700 p-6"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-widest">NEW_DEPLOYMENT</h2>
            <button className="text-zinc-400 hover:text-white transition-colors text-lg leading-none" onClick={onClose}>×</button>
          </div>

          {error && (
            <div className="mb-4 border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              <span className="font-bold">ERROR //</span> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Name */}
            <div>
              <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">PROJECT_NAME</label>
              <input
                type="text" required disabled={isSubmitting}
                placeholder="ex: AUTH-SERVICE"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-black border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-zinc-400 disabled:opacity-50"
              />
            </div>

            {/* CWD with live validation */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-zinc-500 text-xs uppercase tracking-widest">WORKING_DIR</label>
                <ValidationIndicator state={cwdValidation} />
              </div>
              <input
                type="text" disabled={isSubmitting}
                placeholder="ex: C:/Repos/mon-projet"
                value={formData.cwd}
                onChange={e => setFormData({ ...formData, cwd: e.target.value })}
                className={`w-full bg-black border px-3 py-2 text-sm text-white placeholder-zinc-700 focus:outline-none disabled:opacity-50 ${
                  cwdValidation === 'error' ? 'border-red-700 focus:border-red-500' :
                  cwdValidation === 'ok' ? 'border-green-800 focus:border-green-600' :
                  'border-zinc-700 focus:border-zinc-400'
                }`}
              />
            </div>

            {/* Script with live validation */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-zinc-500 text-xs uppercase tracking-widest">LAUNCH_SCRIPT</label>
                <ValidationIndicator state={formData.script ? scriptValidation : 'idle'} />
              </div>
              <input
                type="text" required disabled={isSubmitting}
                placeholder="ex: app.js"
                value={formData.script}
                onChange={e => setFormData({ ...formData, script: e.target.value })}
                className={`w-full bg-black border px-3 py-2 text-sm text-white placeholder-zinc-700 focus:outline-none disabled:opacity-50 ${
                  formData.script && scriptValidation === 'error' ? 'border-red-700 focus:border-red-500' :
                  formData.script && scriptValidation === 'ok' ? 'border-green-800 focus:border-green-600' :
                  'border-zinc-700 focus:border-zinc-400'
                }`}
              />
            </div>

            {/* Args */}
            <div>
              <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">ARGUMENTS</label>
              <input
                type="text" disabled={isSubmitting}
                placeholder="ex: --port 3000"
                value={formData.args}
                onChange={e => setFormData({ ...formData, args: e.target.value })}
                className="w-full bg-black border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-zinc-400 disabled:opacity-50"
              />
            </div>

            <button
              type="submit" disabled={isSubmitting}
              className="mt-2 border border-zinc-600 px-4 py-2 text-sm uppercase tracking-widest hover:border-white hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'INITIATING...' : 'INITIATE_DEPLOYMENT'}
            </button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
