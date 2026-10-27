import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { ProcessManager, type ProcessManagerOptions } from '@/lib/process-manager';
import type { LaunchSpec } from '@/lib/types';

const T = 15_000;

function spec(command: string): LaunchSpec {
  return { command, cwd: process.cwd(), source: 'manual' };
}

// Long-lived throwaway process that prints its own pid first.
const LONG = spec(`node -e "console.log(process.pid); setInterval(() => {}, 1000)"`);
const CRASH = spec(`node -e "console.error('boom'); process.exit(3)"`);

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describe('ProcessManager', () => {
  let dir: string;
  let pidFile: string;
  let manager: ProcessManager;

  const make = (opts: Partial<ProcessManagerOptions> = {}) =>
    (manager = new ProcessManager({ pidFile, backoffMs: () => 50, crashWindowMs: 60_000, ...opts }));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-pm-'));
    pidFile = path.join(dir, 'pids.json');
    make();
  });

  afterEach(() => {
    manager.killAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('captures stdout and stderr with increasing seq', async () => {
    manager.start('svc', spec(`node -e "console.log('hello'); console.error('oops'); setInterval(() => {}, 1000)"`), {});
    await waitFor(() => manager.logs('svc', 0).filter((l) => l.stream !== 'sys').length >= 2);
    const lines = manager.logs('svc', 0);
    expect(lines.find((l) => l.stream === 'out')?.text).toBe('hello');
    expect(lines.find((l) => l.stream === 'err')?.text).toBe('oops');
    const seqs = lines.map((l) => l.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    const last = seqs[seqs.length - 1];
    expect(manager.logs('svc', last)).toEqual([]);
    expect(manager.logs('svc', seqs[0]).map((l) => l.seq)).toEqual(seqs.slice(1));
  }, T);

  it('passes env to the child', async () => {
    manager.start('svc', spec(`node -e "console.log(process.env.FOO); setInterval(() => {}, 1000)"`), { FOO: 'bar-123' });
    await waitFor(() => manager.logs('svc', 0).some((l) => l.text === 'bar-123'));
  }, T);

  it('stop resolves once the process tree is gone and status is stopped', async () => {
    manager.start('svc', LONG, {});
    await waitFor(() => manager.logs('svc', 0).some((l) => /^\d+$/.test(l.text)));
    const grandChild = Number(manager.logs('svc', 0).find((l) => /^\d+$/.test(l.text))!.text);
    const shellPid = manager.status('svc').pid!;
    expect(manager.status('svc').status).toBe('running');
    expect(isAlive(grandChild)).toBe(true);

    await manager.stop('svc');

    const st = manager.status('svc');
    expect(st.status).toBe('stopped');
    expect(st.pid).toBeNull();
    await waitFor(() => !isAlive(grandChild) && !isAlive(shellPid), 3000);
    expect(manager.logs('svc', 0).some((l) => l.stream === 'sys' && l.text.includes('Planté'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(pidFile, 'utf8'))).toEqual({});
  }, T);

  it('reports stopped for unknown projects and start is a no-op when already running', async () => {
    expect(manager.status('nope')).toEqual({ status: 'stopped', pid: null, uptimeMs: 0, restarts: 0, lastCrash: null });
    expect(manager.logs('nope', 0)).toEqual([]);
    await manager.stop('nope');

    manager.start('svc', LONG, {});
    const pid = manager.status('svc').pid;
    manager.start('svc', LONG, {});
    expect(manager.status('svc').pid).toBe(pid);
  }, T);

  it('records the running pid in the pidFile', async () => {
    manager.start('svc', LONG, {});
    const pid = manager.status('svc').pid;
    expect(JSON.parse(fs.readFileSync(pidFile, 'utf8'))).toEqual({ svc: { pid, startedAt: expect.any(Number) } });
  }, T);

  it('restarts after a crash and records lastCrash with stderr tail', async () => {
    manager.start('svc', CRASH, {});
    await waitFor(() => manager.status('svc').lastCrash !== null);
    const crash = manager.status('svc').lastCrash!;
    expect(crash.exitCode).toBe(3);
    expect(crash.tail).toContain('boom');
    expect(typeof crash.at).toBe('number');
    await waitFor(() => manager.status('svc').restarts >= 1);
    expect(manager.logs('svc', 0).some((l) => l.stream === 'sys' && l.text.startsWith('✖ Planté (code 3) — relance dans '))).toBe(true);
  }, T);

  it('shows restarting while waiting for the relaunch', async () => {
    make({ backoffMs: () => 5000 });
    manager.start('svc', CRASH, {});
    await waitFor(() => manager.status('svc').status === 'restarting');
    expect(manager.status('svc').pid).toBeNull();
    expect(manager.logs('svc', 0).some((l) => l.text === '✖ Planté (code 3) — relance dans 5s')).toBe(true);
    await manager.stop('svc');
    expect(manager.status('svc').status).toBe('stopped');
  }, T);

  it('gives up after 5 crashes in the window', async () => {
    manager.start('svc', CRASH, {});
    await waitFor(() => manager.status('svc').status === 'failed');
    expect(manager.status('svc').pid).toBeNull();
    const failedLines = manager.logs('svc', 0).filter((l) => l.text === '✖ 5 plantages en 60 s — relance automatique arrêtée');
    expect(failedLines).toHaveLength(1);
    const seqAtFailure = manager.logs('svc', 0).at(-1)!.seq;
    await new Promise((r) => setTimeout(r, 500));
    expect(manager.status('svc').status).toBe('failed');
    expect(manager.status('svc').pid).toBeNull();
    expect(manager.logs('svc', seqAtFailure)).toEqual([]);
  }, T);

  it('manual start after failed resets the counter', async () => {
    const crashes = () => manager.logs('svc', 0).filter((l) => l.text.startsWith('✖ Planté')).length;
    manager.start('svc', CRASH, {});
    await waitFor(() => manager.status('svc').status === 'failed');
    expect(crashes()).toBe(4);

    manager.start('svc', CRASH, {});
    expect(manager.status('svc').status).toBe('running');
    await waitFor(() => manager.status('svc').status === 'failed');
    // With a reset counter the second cycle again needs 4 relaunch notices before giving up.
    expect(crashes()).toBe(8);
  }, T);

  it('keeps the seq increasing across restarts', async () => {
    manager.start('svc', LONG, {});
    await waitFor(() => manager.logs('svc', 0).length >= 1);
    const before = manager.logs('svc', 0).at(-1)!.seq;
    await manager.restart('svc', LONG, {});
    await waitFor(() => manager.logs('svc', before).some((l) => l.stream === 'out'));
    expect(manager.logs('svc', before).every((l) => l.seq > before)).toBe(true);
    expect(manager.status('svc').status).toBe('running');
  }, T);

  it('clears lastCrash once the new process has stayed up', async () => {
    make({ backoffMs: () => 5000, stableMs: 300 });
    manager.start('svc', CRASH, {});
    await waitFor(() => manager.status('svc').lastCrash !== null);
    manager.start('svc', LONG, {});
    expect(manager.status('svc').status).toBe('running');
    expect(manager.status('svc').lastCrash).not.toBeNull();
    await waitFor(() => manager.status('svc').lastCrash === null, 3000);
  }, T);

  it('trims logs to maxLogLines', async () => {
    make({ maxLogLines: 10 });
    manager.start('svc', spec(`node -e "for (let i = 1; i <= 30; i++) console.log('l' + i); setInterval(() => {}, 1000)"`), {});
    await waitFor(() => manager.logs('svc', 0).some((l) => l.text === 'l30'));
    const lines = manager.logs('svc', 0);
    expect(lines).toHaveLength(10);
    expect(lines[0].text).toBe('l21');
    expect(lines[9].seq).toBe(30);
  }, T);

  it('killAll kills every running child synchronously', async () => {
    manager.start('a', LONG, {});
    manager.start('b', LONG, {});
    await waitFor(() => manager.logs('a', 0).length >= 1 && manager.logs('b', 0).length >= 1);
    const pids = ['a', 'b'].flatMap((n) => [manager.status(n).pid!, Number(manager.logs(n, 0)[0].text)]);
    expect(pids.every(isAlive)).toBe(true);

    manager.killAll();

    expect(manager.status('a').status).toBe('stopped');
    expect(manager.status('b').status).toBe('stopped');
    await waitFor(() => pids.every((p) => !isAlive(p)), 3000);
    expect(JSON.parse(fs.readFileSync(pidFile, 'utf8'))).toEqual({});
    await new Promise((r) => setTimeout(r, 300));
    expect(manager.status('a').status).toBe('stopped');
  }, T);

  const spawnOrphan = () => {
    const orphan = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    orphan.unref();
    return orphan.pid!;
  };
  const killQuietly = (pid: number) => {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  };

  it('cleanupOrphans kills pids left in pidFile when startedAt matches', async () => {
    const pid = spawnOrphan();
    try {
      expect(isAlive(pid)).toBe(true);
      fs.writeFileSync(pidFile, JSON.stringify({ ghost: { pid, startedAt: Date.now() } }));

      manager.cleanupOrphans();

      await waitFor(() => !isAlive(pid), 3000);
      expect(JSON.parse(fs.readFileSync(pidFile, 'utf8'))).toEqual({});
    } finally {
      killQuietly(pid);
    }
  }, T);

  it('cleanupOrphans spares a pid whose startedAt does not match (pid reuse)', async () => {
    const pid = spawnOrphan();
    try {
      fs.writeFileSync(pidFile, JSON.stringify({ ghost: { pid, startedAt: Date.now() - 3_600_000 } }));

      manager.cleanupOrphans();

      await new Promise((r) => setTimeout(r, 500));
      expect(isAlive(pid)).toBe(true);
      expect(JSON.parse(fs.readFileSync(pidFile, 'utf8'))).toEqual({});
    } finally {
      killQuietly(pid);
    }
  }, T);

  it('cleanupOrphans clears a pidFile older than the last boot without killing', async () => {
    const pid = spawnOrphan();
    try {
      fs.writeFileSync(pidFile, JSON.stringify({ ghost: { pid, startedAt: Date.now() } }));
      const beforeBoot = new Date(Date.now() - os.uptime() * 1000 - 60_000);
      fs.utimesSync(pidFile, beforeBoot, beforeBoot);

      manager.cleanupOrphans();

      await new Promise((r) => setTimeout(r, 500));
      expect(isAlive(pid)).toBe(true);
      expect(JSON.parse(fs.readFileSync(pidFile, 'utf8'))).toEqual({});
    } finally {
      killQuietly(pid);
    }
  }, T);

  it('stop gives up after the timeout, logs it and settles to stopped', async () => {
    make({ stopTimeoutMs: 1 });
    manager.start('svc', LONG, {});
    const pid = manager.status('svc').pid!;

    await manager.stop('svc');

    expect(manager.status('svc').status).toBe('stopped');
    expect(manager.logs('svc', 0).some((l) => l.stream === 'sys' && l.text === `✖ Impossible d'arrêter le process (pid ${pid})`)).toBe(true);
  }, T);

  it('cleanupOrphans tolerates a missing or corrupt pidFile', () => {
    expect(() => manager.cleanupOrphans()).not.toThrow();
    fs.writeFileSync(pidFile, 'not json');
    expect(() => manager.cleanupOrphans()).not.toThrow();
  });
});
