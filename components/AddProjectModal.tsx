'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: { name: string; script: string; args: string[]; cwd: string }) => Promise<void>;
}

export default function AddProjectModal({ isOpen, onClose, onAdd }: Props) {
  const [formData, setFormData] = useState({ name: '', script: '', args: '', cwd: '' });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const fields = [
    { label: 'PROJECT_NAME', key: 'name' as const, required: true, placeholder: 'ex: AUTH-SERVICE' },
    { label: 'LAUNCH_SCRIPT', key: 'script' as const, required: true, placeholder: 'ex: app.js' },
    { label: 'ARGUMENTS', key: 'args' as const, required: false, placeholder: 'ex: --port 3000' },
    { label: 'WORKING_DIR', key: 'cwd' as const, required: false, placeholder: 'ex: C:/Repos/mon-projet' },
  ] as const;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/80 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-zinc-950 border border-zinc-700 p-6"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-widest">NEW_DEPLOYMENT</h2>
              <button
                className="text-zinc-400 hover:text-white transition-colors text-lg leading-none"
                onClick={onClose}
              >
                ×
              </button>
            </div>

            {error && (
              <div className="mb-4 border border-red-800 bg-red-950/30 px-3 py-2 text-xs text-red-400">
                <span className="font-bold">ERROR //</span> {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {fields.map(({ label, key, required, placeholder }) => (
                <div key={key}>
                  <label className="text-zinc-500 text-xs uppercase tracking-widest block mb-1">
                    {label}
                  </label>
                  <input
                    type="text"
                    required={required}
                    disabled={isSubmitting}
                    placeholder={placeholder}
                    value={formData[key]}
                    onChange={e => setFormData({ ...formData, [key]: e.target.value })}
                    className="w-full bg-black border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-zinc-400 disabled:opacity-50"
                  />
                </div>
              ))}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 border border-zinc-600 px-4 py-2 text-sm uppercase tracking-widest hover:border-white hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'INITIATING...' : 'INITIATE_DEPLOYMENT'}
              </button>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
