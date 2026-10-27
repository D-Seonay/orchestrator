import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
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

  let managers: ProcessManager[];
  // Throwaway processes spawned directly by a test, killed by exact pid in afterEach.
  let extraPids: number[];

  const make = (opts: Partial<ProcessManagerOptions> = {}) => {
    manager = new ProcessManager({ pidFile, backoffMs: () => 50, crashWindowMs: 60_000, ...opts });
    managers.push(manager);
    return manager;
  };

  // Pid of the grandchild node (first all-digits stdout line of LONG), once it exists.
  const grandChildPid = (name: string): number | undefined => {
    const line = manager.logs(name, 0).find((l) => l.stream === 'out' && /^\d+$/.test(l.text));
    return line ? Number(line.text) : undefined;
  };

  // Starts LONG and waits until its grandchild exists, so a later stop/kill really reaches it.
  const startLong = async (name: string): Promise<number> => {
    manager.start(name, LONG, {});
    await waitFor(() => grandChildPid(name) !== undefined);
    return grandChildPid(name)!;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-pm-'));
    pidFile = path.join(dir, 'pids.json');
    managers = [];
    extraPids = [];
    make();
  });

  afterEach(() => {
    const recorded = new Set<number>();
    for (const m of managers) {
      const names = (m as unknown as { entries: Map<string, unknown> }).entries.keys();
      for (const name of names) {
        for (const l of m.logs(name, 0)) if (l.stream === 'out' && /^\d+$/.test(l.text)) recorded.add(Number(l.text));
      }
      m.killAll();
    }
    // Safety net: force-kill, by exact pid only, any grandchild we recorded that is still alive.
    for (const pid of [...recorded, ...extraPids]) {
      if (isAlive(pid)) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
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

  describe('environment', () => {
    const HOST = { PORT: '3000', NODE_ENV: 'production', NODE_OPTIONS: '--no-warnings', NEXT_RUNTIME: 'nodejs' };
    let saved: Record<string, string | undefined>;
    const PRINT = spec(
      `node -e "console.log(process.pid); console.log(['ENV', process.env.PORT, process.env.NODE_ENV, process.env.NODE_OPTIONS, process.env.NEXT_RUNTIME].join('|')); setInterval(() => {}, 1000)"`,
    );
    const envLine = () => manager.logs('svc', 0).find((l) => l.text.startsWith('ENV|'))?.text;

    beforeEach(() => {
      saved = {};
      for (const [k, v] of Object.entries(HOST)) {
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

    it('does not leak the host PORT, NODE_ENV, NODE_OPTIONS or Next variables to the service', async () => {
      manager.start('svc', PRINT, {});
      await waitFor(() => envLine() !== undefined);
      expect(envLine()).toBe('ENV||||');
    }, T);

    it('passes them when they are in the project env', async () => {
      manager.start('svc', PRINT, { PORT: '4100', NODE_ENV: 'development', NODE_OPTIONS: '--no-deprecation' });
      await waitFor(() => envLine() !== undefined);
      expect(envLine()).toBe('ENV|4100|development|--no-deprecation|');
    }, T);

    it("applies the project NODE_OPTIONS to the service, not to the watchdog", async () => {
      const preload = path.join(dir, 'preload.cjs');
      fs.writeFileSync(preload, "console.log('PRELOAD ' + process.pid);\n");
      // NODE_OPTIONS traite « \ » comme un échappement entre guillemets : chemin en « / ».
      manager.start('svc', LONG, { NODE_OPTIONS: `--require "${preload.replace(/\\/g, '/')}"` });
      await waitFor(() => grandChildPid('svc') !== undefined);
      const preloads = manager.logs('svc', 0).filter((l) => l.text.startsWith('PRELOAD ')).map((l) => Number(l.text.slice(8)));
      expect(preloads).toEqual([grandChildPid('svc')]);
      expect(preloads).not.toContain(manager.status('svc').pid);
    }, T);
  });

  it('stop resolves once the process tree is gone and status is stopped', async () => {
    const grandChild = await startLong('svc');
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

    await startLong('svc');
    const pid = manager.status('svc').pid;
    manager.start('svc', LONG, {});
    expect(manager.status('svc').pid).toBe(pid);
  }, T);

  it('records the running pid in the pidFile', async () => {
    await startLong('svc');
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
    await startLong('svc');
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
    await startLong('svc');
    expect(manager.status('svc').status).toBe('running');
    await waitFor(() => manager.status('svc').lastCrash === null, 3000);
  }, T);

  it('a stale exit from a stopped run does not cancel the next run\'s stability timer', async () => {
    make({ backoffMs: () => 5000, stableMs: 1500, stopTimeoutMs: 1 });
    manager.start('svc', CRASH, {});
    await waitFor(() => manager.status('svc').lastCrash !== null);
    await startLong('svc');
    // stop() gives up after 1 ms, so the old run's exit event arrives after the new run has started.
    await manager.stop('svc');
    const second = spec(`node -e "console.log('second', process.pid); setInterval(() => {}, 1000)"`);
    manager.start('svc', second, {});
    expect(manager.status('svc').status).toBe('running');
    expect(manager.status('svc').lastCrash).not.toBeNull();
    await waitFor(() => manager.logs('svc', 0).some((l) => l.text.startsWith('second ')));
    await waitFor(() => manager.status('svc').lastCrash === null, 4000);
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

  it('kills the service tree when the orchestrator process is hard-killed', async () => {
    // Stand-in for the Orchestrator server: the watchdog watches this pid instead of the test runner.
    const fakeOrchestrator = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000) // pm-fake-orchestrator'], { stdio: 'ignore' });
    const orchestratorPid = fakeOrchestrator.pid!;
    extraPids.push(orchestratorPid);
    // Long backoff: the manager (which survives here, unlike in real life) must not relaunch during the test.
    make({ orchestratorPid, backoffMs: () => 60_000 });
    const grandChild = await startLong('svc');
    const watchdog = manager.status('svc').pid!;
    expect(isAlive(grandChild)).toBe(true);

    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(orchestratorPid), '/F'], { stdio: 'ignore' });
    else process.kill(orchestratorPid, 'SIGKILL');

    await waitFor(() => !isAlive(grandChild) && !isAlive(watchdog), 5000);
  }, T);

  it('kills the service tree when its real parent Orchestrator process is hard-killed', async () => {
    // Unlike the test above, the watchdog's parent itself dies here (Windows job objects tie children to it).
    const host = spawn(process.execPath, ['--import', 'tsx', path.join('tests', 'helpers', 'pm-host.ts'), path.join(dir, 'host-pids.json'), LONG.command], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'inherit'],
    });
    extraPids.push(host.pid!);
    let out = '';
    host.stdout!.on('data', (d) => { out += String(d); });
    await waitFor(() => /PIDS \d+ \d+/.test(out));
    const [watchdog, grandChild] = /PIDS (\d+) (\d+)/.exec(out)!.slice(1).map(Number);
    extraPids.push(watchdog, grandChild);
    expect(isAlive(grandChild)).toBe(true);

    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(host.pid), '/F'], { stdio: 'ignore' });
    else process.kill(host.pid!, 'SIGKILL');

    await waitFor(() => !isAlive(grandChild) && !isAlive(watchdog), 5000);
  }, T);

  it('stop gives up after the timeout, logs it and settles to stopped', async () => {
    make({ stopTimeoutMs: 1 });
    await startLong('svc');
    const pid = manager.status('svc').pid!;

    await manager.stop('svc');

    expect(manager.status('svc').status).toBe('stopped');
    expect(manager.logs('svc', 0).some((l) => l.stream === 'sys' && l.text === `✖ Impossible d'arrêter le process (pid ${pid})`)).toBe(true);
  }, T);

  it('log appends external lines to the project logs', () => {
    make();
    manager.log('svc', 'sys', '\u001b[32mhello\u001b[0m');
    expect(manager.logs('svc', 0).map((l) => [l.stream, l.text])).toEqual([['sys', 'hello']]);
  });

  it('cleanupOrphans tolerates a missing or corrupt pidFile', () => {
    expect(() => manager.cleanupOrphans()).not.toThrow();
    fs.writeFileSync(pidFile, 'not json');
    expect(() => manager.cleanupOrphans()).not.toThrow();
  });
});
