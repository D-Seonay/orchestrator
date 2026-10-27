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
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { ...defaults(), ...parsed };
      } catch {
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
