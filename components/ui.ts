// Classes partagées du thème clair (Tailwind ne détecte que les noms écrits en entier).

const BTN_BASE =
  'inline-flex items-center justify-center gap-1 rounded-md text-[13px] whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** Bouton secondaire : blanc, bordure fine. */
export const BTN = `${BTN_BASE} h-8 px-3 border border-line bg-white text-ink enabled:hover:bg-hover`;
/** Bouton principal : le seul en bleu. */
export const BTN_PRIMARY = `${BTN_BASE} h-8 px-3 bg-accent text-white font-medium enabled:hover:bg-accent-strong`;
/** Bouton icône discret (actions de ligne, fermeture). */
export const ICON_BTN = `${BTN_BASE} h-7 min-w-7 px-1.5 text-muted enabled:hover:bg-line-soft enabled:hover:text-ink`;

export const INPUT =
  'h-8 px-2.5 rounded-md text-[13px] bg-white border border-line text-ink placeholder:text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

export const LABEL = 'text-xs text-muted';

export const TAG = 'inline-flex items-center px-1.5 rounded text-xs leading-5 whitespace-nowrap';
