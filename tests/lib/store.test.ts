import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createStore, DEFAULT_ROOT } from '@/lib/store';
import type { StoredState } from '@/lib/types';

describe('store', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-store-'));
    file = path.join(dir, 'data', 'state.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('DEFAULT_ROOT is the Windows path with real backslashes', () => {
    expect(DEFAULT_ROOT).toBe('C:\\Repositories\\AtoolDev\\semaphore');
  });

  it('load returns defaults when file is missing', () => {
    expect(createStore(file).load()).toEqual({ root: DEFAULT_ROOT, projects: {}, groups: {} });
  });

  it('load sets a corrupt file aside (never overwritten) and returns defaults', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{oops');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = createStore(file);
      expect(store.load()).toEqual({ root: DEFAULT_ROOT, projects: {}, groups: {} });
      expect(errors).toHaveBeenCalledOnce();

      const files = fs.readdirSync(path.dirname(file));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^state\.json\.corrupt-\d{4}-\d{2}-\d{2}T[\d-]+Z$/);
      expect(fs.readFileSync(path.join(path.dirname(file), files[0]), 'utf8')).toBe('{oops');

      // Le save suivant crée un nouveau state.json sans toucher à la copie mise de côté.
      store.save({ root: DEFAULT_ROOT, projects: {}, groups: {} });
      expect(fs.readdirSync(path.dirname(file)).sort()).toEqual([files[0], 'state.json'].sort());
    } finally {
      errors.mockRestore();
    }
  });

  it('save then load round-trips', () => {
    const state: StoredState = {
      root: 'D:\\repos',
      projects: {
        'api-semaphore': {
          launch: { command: 'node server.js', cwd: 'D:\\repos\\api-semaphore', source: 'manual' },
          env: { PORT: '3000' },
          importedAt: '2026-10-27T10:00:00.000Z',
        },
      },
      groups: { backend: ['api-semaphore'] },
    };
    const store = createStore(file);
    store.save(state);
    expect(store.load()).toEqual(state);
  });

  it('save creates parent directory and leaves no .tmp file', () => {
    createStore(file).save({ root: DEFAULT_ROOT, projects: {}, groups: {} });
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['state.json']);
  });
});
