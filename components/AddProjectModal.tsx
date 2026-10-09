'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: {
    name: string;
    type: 'node' | 'docker';
    script: string;
    args: string[];
    cwd: string;
    ports?: string[];
    autoStart?: boolean;
    env?: Record<string, string>;
  }) => Promise<void>;
}

type ValidationState = 'idle' | 'checking' | 'ok' | 'error';

function usePathValidation(path: string, debounceMs = 600): ValidationState {
  const trimmed = path.trim();
  const [asyncState, setAsyncState] = useState<ValidationState | null>(null);

  useEffect(() => {
    if (!trimmed) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/validate-path?path=${encodeURIComponent(trimmed)}`);
        setAsyncState(res.ok ? 'ok' : 'error');
      } catch {
        setAsyncState('error');
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [trimmed, debounceMs]);

  if (!trimmed) return 'idle';
  return asyncState ?? 'checking';
}

function ValidationIndicator({ state }: { state: ValidationState }) {
  if (state === 'idle') return null;
  if (state === 'checking') return <span className="text-zinc-600 text-xs">...</span>;
  if (state === 'ok') return <span className="text-green-400 text-xs">✓</span>;
  return <span className="text-red-400 text-xs">✗ not found</span>;
}

export default function AddProjectModal({ isOpen, onClose, onAdd }: Props) {
  const [formData, setFormData] = useState({ 
    name: '', 
    type: 'node' as 'node' | 'docker',
    script: '', 
    args: '', 
    cwd: '',
    ports: '',
    autoStart: true,
    language: '' as '' | 'fr' | 'en' | 'es',
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cwdValidation = usePathValidation(formData.cwd);
  // Validate script/dockerfile relative to cwd (or absolute)
  const scriptPath = formData.cwd && formData.script
    ? `${formData.cwd}/${formData.script}`
    : formData.script;
  const scriptValidation = usePathValidation(scriptPath);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const env = { ...formData.language ? { OPTION: formData.language === 'fr' ? '1' : formData.language === 'en' ? '2' : '3' } : {} };

      await onAdd({
        name: formData.name,
        type: formData.type,
        script: formData.script,
        args: formData.args.split(' ').filter(Boolean),
        cwd: formData.cwd,
        ports: formData.ports.split(',').map(p => p.trim()).filter(Boolean),
        autoStart: formData.autoStart,
        env,
      });
      setFormData({ name: '', type: 'node', script: '', args: '', cwd: '', ports: '', autoStart: true, language: '' });
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
            {/* Type Switcher */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, type: 'node' })}
                className={`flex-1 px-3 py-1.5 text-[10px] uppercase tracking-tighter border ${
                  formData.type === 'node' ? 'bg-zinc-100 text-black border-white' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'
                }`}
              >
                NODE_JS
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, type: 'docker' })}
                className={`flex-1 px-3 py-1.5 text-[10px] uppercase tracking-tighter border ${
                  formData.type === 'docker' ? 'bg-zinc-100 text-black border-white' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'
                }`}
              >
                DOCKER
              </button>
            </div>

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

            {/* Script / Dockerfile with live validation */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-zinc-500 text-xs uppercase tracking-widest">
                  {formData.type === 'node' ? 'LAUNCH_SCRIPT' : 'DOCKERFILE'}
                </label>
                <ValidationIndicator state={formData.script ? scriptValidation : 'idle'} />
              </div>
              <input
                type="text" required={formData.type === 'node'} disabled={isSubmitting}
                placeholder={formData.type === 'node' ? 'ex: app.js' : 'ex: Dockerfile (optional)'}
                value={formData.script}
                onChange={e => setFormData({ ...formData, script: e.target.value })}
                className={`w-full bg-black border px-3 py-2 text-sm text-white placeholder-zinc-700 focus:outline-none disabled:opacity-50 ${
                  formData.script && scriptValidation === 'error' ? 'border-red-700 focus:border-red-500' :
                  formData.script && scriptValidation === 'ok' ? 'border-green-800 focus:border-green-600' :
                  'border-zinc-700 focus:border-zinc-400'
                }`}
              />
            </div>

            {/* Args / Ports */}
            {formData.type === 'node' ? (
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
            ) : (
              <div>
                <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">PORT_MAPPINGS</label>
                <input
                  type="text" disabled={isSubmitting}
                  placeholder="ex: 8080:80, 3000:3000"
                  value={formData.ports}
                  onChange={e => setFormData({ ...formData, ports: e.target.value })}
                  className="w-full bg-black border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-zinc-400 disabled:opacity-50"
                />
              </div>
            )}

            {/* Language Selection (Optional) */}
            <div>
              <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">DATABASE_LANGUAGE (OPTIONAL)</label>
              <div className="flex gap-2">
                {[
                  { label: 'FRANÇAIS', value: 'fr' as const },
                  { label: 'ENGLISH', value: 'en' as const },
                  { label: 'ESPAÑOL', value: 'es' as const },
                ].map(lang => (
                  <button
                    key={lang.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, language: formData.language === lang.value ? '' : lang.value })}
                    className={`flex-1 px-2 py-1.5 text-[10px] uppercase tracking-tighter border ${
                      formData.language === lang.value ? 'bg-zinc-100 text-black border-white' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto Start Toggle */}
            <div className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                id="autoStart"
                checked={formData.autoStart}
                onChange={e => setFormData({ ...formData, autoStart: e.target.checked })}
                className="w-4 h-4 accent-zinc-500 bg-black border border-zinc-700"
              />
              <label htmlFor="autoStart" className="text-zinc-500 text-[10px] uppercase tracking-widest cursor-pointer">
                AUTO_START_ON_BOOT
              </label>
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
