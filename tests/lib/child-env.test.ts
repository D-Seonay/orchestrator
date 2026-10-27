import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { childEnv, watchdogEnv, CHILD_NODE_OPTIONS } from '@/lib/child-env';

const HOST_VARS = {
  NODE_ENV: 'production',
  PORT: '3000',
  NODE_OPTIONS: '--max-old-space-size=4096',
  __NEXT_PRIVATE_ORIGIN: 'x',
  NEXT_RUNTIME: 'nodejs',
  NEXT_PRIVATE_WORKER: '1',
  TURBOPACK: '1',
  ORCH_KEEP_ME: 'kept',
};

describe('childEnv', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const [k, v] of Object.entries(HOST_VARS)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('drops the variables Next sets in its own process and keeps the rest', () => {
    const env = childEnv();
    for (const k of ['NODE_ENV', 'PORT', 'NODE_OPTIONS', '__NEXT_PRIVATE_ORIGIN', 'NEXT_RUNTIME', 'NEXT_PRIVATE_WORKER', 'TURBOPACK']) {
      expect(env[k]).toBeUndefined();
    }
    expect(env.ORCH_KEEP_ME).toBe('kept');
    expect(Object.keys(env).some((k) => k.toUpperCase() === 'PATH')).toBe(true);
  });

  it('project variables win, including NODE_ENV, PORT and NODE_OPTIONS', () => {
    const env = childEnv({ NODE_ENV: 'development', PORT: '4100', NODE_OPTIONS: '--no-warnings', ORCH_KEEP_ME: 'project' });
    expect(env).toMatchObject({ NODE_ENV: 'development', PORT: '4100', NODE_OPTIONS: '--no-warnings', ORCH_KEEP_ME: 'project' });
  });

  it.runIf(process.platform === 'win32')('replaces a host variable of another case instead of duplicating it', () => {
    const hostKey = Object.keys(childEnv()).find((k) => k.toUpperCase() === 'PATH')!;
    const other = hostKey === 'PATH' ? 'Path' : 'PATH';
    const env = childEnv({ [other]: 'C:\\only' });
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')).toEqual([other]);
  });

  it('watchdogEnv moves the project NODE_OPTIONS to the dedicated variable', () => {
    expect(watchdogEnv({ NODE_OPTIONS: '--no-warnings' })).toMatchObject({ [CHILD_NODE_OPTIONS]: '--no-warnings' });
    expect(watchdogEnv({ NODE_OPTIONS: '--no-warnings' }).NODE_OPTIONS).toBeUndefined();
    expect(watchdogEnv({})[CHILD_NODE_OPTIONS]).toBeUndefined();
  });
});
