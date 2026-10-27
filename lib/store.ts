import fs from 'fs';
import path from 'path';
import type { StoredState } from './types';

export const DEFAULT_ROOT = 'C:\\Repositories\\AtoolDev\\semaphore';

function defaults(): StoredState {
  return { root: DEFAULT_ROOT, projects: {}, groups: {} };
}

export function createStore(filePath: string): { load(): StoredState; save(state: StoredState): void } {
  return {
    load() {
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, 'utf8');
      } catch {
        return defaults(); // pas encore de fichier
      }
      try {
        return { ...defaults(), ...JSON.parse(raw) };
      } catch (err) {
        // JSON illisible (édition manuelle ratée) : on le met de côté au lieu de l'écraser au prochain save.
        const aside = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        try {
          fs.renameSync(filePath, aside);
          console.error(`[store] ${filePath} illisible (${(err as Error).message}) — renommé en ${aside}, réglages par défaut`);
        } catch (renameErr) {
          console.error(`[store] ${filePath} illisible et impossible à renommer :`, renameErr);
        }
        return defaults();
      }
    },
    save(state) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, filePath);
    },
  };
}

export const store = createStore(path.join(process.cwd(), 'data', 'state.json'));
