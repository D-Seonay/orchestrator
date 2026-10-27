'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { BTN, BTN_PRIMARY } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg flex flex-col gap-5"
      >
        <span className="text-5xl" aria-hidden>
          🧭
        </span>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-ink">Page introuvable</h1>
          <p className="text-[15px] text-ink-soft">Cette adresse ne correspond à aucune page d&apos;Orchestrator.</p>
          <p className="text-[13px] text-muted">
            Adresse mal saisie ou lien périmé ? Les services se pilotent depuis le tableau de bord.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/" className={`${BTN_PRIMARY} hover:bg-accent-strong`}>
            Retour au tableau de bord
          </Link>
          <button
            onClick={() => {
              if (typeof window !== 'undefined') window.history.back();
            }}
            className={BTN}
          >
            ← Page précédente
          </button>
        </div>

        <p className="pt-4 border-t border-line text-xs text-muted">🚦 Orchestrator · erreur 404</p>
      </motion.div>
    </div>
  );
}
