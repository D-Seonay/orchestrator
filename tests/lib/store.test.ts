import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  it('load returns defaults when file is missing', () => {
    expect(createStore(file).load()).toEqual({ root: DEFAULT_ROOT, projects: {}, groups: {} });
  });

  it('load returns defaults when file is corrupt JSON', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{oops');
    expect(createStore(file).load()).toEqual({ root: DEFAULT_ROOT, projects: {}, groups: {} });
  });

  it('save then load round-trips', () => {
    const state: StoredState = {
      root: 'D:\repos',
      projects: {
        'api-semaphore': {
          launch: { command: 'node server.js', cwd: 'D:\repos\api-semaphore', source: 'manual' },
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
