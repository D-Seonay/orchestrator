'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black text-white font-mono flex flex-col justify-between p-6 selection:bg-zinc-800">
      <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col justify-center py-12">
        {/* Header bar */}
        <header className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-8">
          <div className="flex items-center gap-3">
            <span className="text-zinc-600 font-bold tracking-widest text-sm">ATD//</span>
            <span className="text-zinc-400 text-xs tracking-wider uppercase">Orchestrator Pro</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-400 text-xs tracking-widest uppercase">ERR_NOT_FOUND</span>
          </div>
        </header>

        {/* Main Terminal Window */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="border border-zinc-800 bg-zinc-950 p-6 md:p-8 flex flex-col gap-6 shadow-2xl relative overflow-hidden"
        >
          {/* Subtle decorative grid/line background */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-600 via-yellow-500 to-transparent opacity-80" />

          {/* Error Tag & Code */}
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-zinc-900 pb-4">
            <div className="flex items-baseline gap-4">
              <span className="text-6xl md:text-8xl font-black tracking-tighter text-zinc-100 selection:text-white">
                404
              </span>
              <span className="text-red-400 text-xs md:text-sm font-semibold tracking-widest uppercase">
                {"//"} RESOURCE_UNAVAILABLE
              </span>
            </div>
            <span className="text-zinc-600 text-xs uppercase tracking-wider font-mono">
              EXIT_CODE: 0x194
            </span>
          </div>

          {/* Terminal / Diagnostic Log */}
          <div className="bg-black border border-zinc-900 p-4 rounded-none font-mono text-xs flex flex-col gap-2">
            <div className="flex items-center gap-2 text-zinc-500 border-b border-zinc-900 pb-2 mb-1">
              <span className="text-red-500 font-bold">●</span>
              <span>SYS_KERNEL: DIAGNOSTIC STACK DUMP</span>
            </div>
            <div className="text-zinc-400">
              <span className="text-red-400 font-bold">[ERR_HTTP_404]</span> The requested URL could not be resolved by the router.
            </div>
            <div className="text-zinc-600">
              [DEBUG] Endpoint query terminated. Target process or resource does not exist.
            </div>
            <div className="text-zinc-600">
              [SYSTEM] Possible reasons: mistyped path, decommissioned route, or removed service.
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
            <Link
              href="/"
              className="bg-white hover:bg-zinc-200 text-black px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors text-center"
            >
              ⌂ Retour au Dashboard
            </Link>
            <button
              onClick={() => {
                if (typeof window !== 'undefined') window.history.back();
              }}
              className="border border-zinc-700 hover:border-white text-zinc-300 hover:text-white px-5 py-2.5 text-xs uppercase tracking-wider transition-colors text-center"
            >
              ← Page précédente
            </button>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto w-full pt-4 border-t border-zinc-900 text-zinc-600 text-xs flex flex-col sm:flex-row justify-between items-center gap-2">
        <div>ORCHESTRATOR STATUS: NOMINAL</div>
        <div>HTTP_STATUS // 404 NOT FOUND</div>
      </footer>
    </div>
  );
}
