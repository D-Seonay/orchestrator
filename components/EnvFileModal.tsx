'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  appName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function EnvFileModal({ appName, isOpen, onClose }: Props) {
  const [content, setContent] = useState('');
  const [filePath, setFilePath] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    setStatus('idle');
    fetch(`/api/apps/${encodeURIComponent(appName)}/envfile`)
      .then(r => r.json())
      .then(data => {
        setContent(data.content ?? '');
        setFilePath(data.path ?? '');
      })
      .finally(() => setIsLoading(false));
  }, [isOpen, appName]);

  const handleSave = async () => {
    setIsSaving(true);
    setStatus('idle');
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(appName)}/envfile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setStatus('saved');
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || `HTTP ${res.status}`);
        setStatus('error');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Network error');
      setStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="env-backdrop"
            className="fixed inset-0 bg-black/80 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            key="env-modal"
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-zinc-950 border border-zinc-700 p-6 flex flex-col gap-4"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest">ENV_FILE</h2>
                <p className="text-zinc-600 text-xs mt-0.5 truncate max-w-[340px]">{filePath || '...'}</p>
              </div>
              <button
                className="text-zinc-400 hover:text-white transition-colors text-lg leading-none ml-4"
                onClick={onClose}
              >
                ×
              </button>
            </div>

            {/* Editor */}
            {isLoading ? (
              <div className="text-zinc-600 text-xs uppercase tracking-widest py-8 text-center">
                LOADING...
              </div>
            ) : (
              <textarea
                className="w-full h-64 bg-black border border-zinc-700 px-3 py-2 text-xs text-white font-mono resize-none focus:outline-none focus:border-zinc-400 placeholder-zinc-700"
                placeholder={'# Variables d\'environnement\nPORT=3000\nNODE_ENV=production'}
                value={content}
                onChange={e => { setContent(e.target.value); setStatus('idle'); }}
                spellCheck={false}
              />
            )}

            {/* Footer */}
            <div className="flex items-center justify-between">
              <span className="text-xs">
                {status === 'saved' && <span className="text-green-400">SAVED — app restarted</span>}
                {status === 'error' && <span className="text-red-400">ERROR // {errorMsg || 'save failed'}</span>}
                {status === 'idle' && <span className="text-zinc-600">Changes trigger auto-restart</span>}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="text-xs text-zinc-500 hover:text-white transition-colors uppercase"
                >
                  CLOSE
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || isLoading}
                  className="text-xs border border-zinc-600 px-3 py-1 hover:border-white hover:text-white transition-colors uppercase disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'SAVING...' : 'SAVE & RESTART'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
