'use client';

import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  projectName: string;
}

export default function DeleteProjectModal({ isOpen, onClose, onConfirm, projectName }: Props) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 bg-black/90 z-[60] backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            key="modal"
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] w-full max-w-sm bg-zinc-950 border border-red-900/50 p-6 shadow-2xl shadow-red-900/10"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Warning Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full border border-red-900/50 flex items-center justify-center bg-red-950/20 shrink-0">
                <span className="text-red-500 text-xl font-bold">!</span>
              </div>
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-red-500">TERMINATE_PROCESS</h2>
                <p className="text-[10px] text-zinc-500 uppercase tracking-tighter">Action irreversible</p>
              </div>
            </div>

            <div className="mb-8">
              <p className="text-xs text-zinc-400 leading-relaxed uppercase tracking-wider">
                Êtes-vous sûr de vouloir supprimer <span className="text-white font-bold">[{projectName}]</span> ? 
                Toutes les configurations et l&apos;historique des logs seront perdus.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className="w-full bg-red-950/20 border border-red-900 hover:bg-red-600 hover:text-white text-red-500 px-4 py-3 text-xs uppercase tracking-widest transition-all font-bold"
              >
                CONFIRMER_LA_SUPPRESSION
              </button>
              <button
                onClick={onClose}
                className="w-full border border-zinc-800 hover:border-zinc-500 text-zinc-500 hover:text-white px-4 py-2 text-[10px] uppercase tracking-widest transition-all"
              >
                ANNULER
              </button>
            </div>

            {/* Decorative Grid Pattern */}
            <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
              <div className="grid grid-cols-2 gap-1">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="w-1 h-1 bg-red-500" />
                ))}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
