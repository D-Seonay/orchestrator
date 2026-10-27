import { spawn, execFile, execFileSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import type { CrashInfo, LaunchSpec, LogLine, ProcessStatus, RunStatus } from './types';
import { stripAnsi } from './utils';

export interface ProcessManagerOptions {
  pidFile: string;
  maxLogLines?: number;
  crashLimit?: number;
  crashWindowMs?: number;
  backoffMs?: (crashCount: number) => number;
  /** How long a process must stay up before the previous crash is forgotten. */
  stableMs?: number;
  /** How long stop() waits for the process to exit before giving up (default 10 s). */
  stopTimeoutMs?: number;
}

const IS_WINDOWS = process.platform === 'win32';
const CRASH_TAIL_LINES = 20;
// Grace period for stdout/stderr to drain after the child exited, so the crash tail is complete.
const DRAIN_TIMEOUT_MS = 250;
// An orphan is only killed if its real creation time is this close to the recorded one (PID reuse guard).
const START_TIME_TOLERANCE_MS = 5000;

const defaultBackoff = (crashCount: number) => Math.min(1500 * 2 ** Math.max(0, crashCount - 1), 10_000);

/** One spawned child, from spawn to exit. */
interface Run {
  child: ChildProcess;
  pid: number;
  startedAt: number;
  exited: boolean;
  stopRequested: boolean;
  settled: boolean;
  exitPromise: Promise<void>;
  settledPromise: Promise<void>;
  resolveExit: () => void;
  resolveSettled: () => void;
  drained: Promise<void>;
  /** Forgets the previous crash once this run stayed up; per run so a stale exit cannot cancel a newer run's timer. */
  stableTimer: NodeJS.Timeout | null;
}

interface Entry {
  name: string;
  spec: LaunchSpec | null;
  env: Record<string, string>;
  status: RunStatus;
  run: Run | null;
  logs: LogLine[];
  seq: number;
  restarts: number;
  crashTimes: number[];
  lastCrash: CrashInfo | null;
  relaunchTimer: NodeJS.Timeout | null;
}

const isValidPid = (pid: unknown): pid is number => typeof pid === 'number' && Number.isInteger(pid) && pid > 0;

/** Creation time (ms epoch) of each live pid; pids that are gone or unreadable are omitted. */
function readStartTimes(pids: number[]): Map<number, number> {
  const times = new Map<number, number>();
  if (pids.length === 0) return times;
  try {
    if (IS_WINDOWS) {
      const script =
        `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ` +
        `Select-Object Id,@{n='t';e={[DateTimeOffset]::new($_.StartTime).ToUnixTimeMilliseconds()}} | ` +
        'ConvertTo-Json -Compress';
      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!out) return times;
      const parsed: unknown = JSON.parse(out);
      for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
        const r = row as { Id?: unknown; t?: unknown };
        if (isValidPid(r.Id) && typeof r.t === 'number' && Number.isFinite(r.t)) times.set(r.Id, r.t);
      }
    } else {
      for (const pid of pids) {
        try {
          const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
            encoding: 'utf8', timeout: 5000, env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'],
          }).trim();
          const t = Date.parse(out);
          if (out && Number.isFinite(t)) times.set(pid, t);
        } catch { /* gone */ }
      }
    }
  } catch {
    // Unable to verify: callers then kill nothing.
  }
  return times;
}

function killTreeSync(pid: number): void {
  if (!isValidPid(pid)) return;
  try {
    if (IS_WINDOWS) execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone (or never a group leader): best effort fallback to the process itself.
    if (!IS_WINDOWS) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    }
  }
}

function killTree(run: Run): void {
  const { pid, child } = run;
  if (!isValidPid(pid)) return;
  const fallback = () => {
    if (run.exited) return;
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  };
  if (IS_WINDOWS) {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], (err) => { if (err) fallback(); });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { fallback(); }
  }
}

function formatDelay(ms: number): string {
  return `${Number((ms / 1000).toFixed(1))}s`;
}

export class ProcessManager {
  private readonly entries = new Map<string, Entry>();
  private readonly pidFile: string;
  private readonly maxLogLines: number;
  private readonly crashLimit: number;
  private readonly crashWindowMs: number;
  private readonly backoffMs: (crashCount: number) => number;
  private readonly stableMs: number;
  private readonly stopTimeoutMs: number;

  constructor(opts: ProcessManagerOptions) {
    this.pidFile = opts.pidFile;
    this.maxLogLines = opts.maxLogLines ?? 5000;
    this.crashLimit = opts.crashLimit ?? 5;
    this.crashWindowMs = opts.crashWindowMs ?? 60_000;
    this.backoffMs = opts.backoffMs ?? defaultBackoff;
    this.stableMs = opts.stableMs ?? 10_000;
    this.stopTimeoutMs = opts.stopTimeoutMs ?? 10_000;
  }

  start(name: string, spec: LaunchSpec, env: Record<string, string>): void {
    const entry = this.entry(name);
    if (entry.status === 'running') return;
    this.clearRelaunch(entry);
    entry.crashTimes = [];
    entry.spec = spec;
    entry.env = env;
    this.launch(entry);
  }

  async stop(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) return;
    this.clearRelaunch(entry);
    const run = entry.run;
    if (!run) {
      entry.status = 'stopped';
      return;
    }
    run.stopRequested = true;
    if (!run.exited) {
      killTree(run);
      let timer: NodeJS.Timeout | undefined;
      const timedOut = await Promise.race([
        run.exitPromise.then(() => false),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), this.stopTimeoutMs); }),
      ]);
      clearTimeout(timer);
      if (timedOut && !run.exited) {
        this.push(entry, 'sys', `✖ Impossible d'arrêter le process (pid ${run.pid})`);
        this.settleStopped(entry, run);
      }
    }
    await run.settledPromise;
  }

  async restart(name: string, spec: LaunchSpec, env: Record<string, string>): Promise<void> {
    const entry = this.entries.get(name);
    if (entry?.run) {
      await this.stop(name);
      entry.restarts++;
    }
    this.start(name, spec, env);
  }

  status(name: string): ProcessStatus {
    const entry = this.entries.get(name);
    if (!entry) return { status: 'stopped', pid: null, uptimeMs: 0, restarts: 0, lastCrash: null };
    const run = entry.run;
    return {
      status: entry.status,
      pid: run ? run.pid : null,
      uptimeMs: run && entry.status === 'running' ? Date.now() - run.startedAt : 0,
      restarts: entry.restarts,
      lastCrash: entry.lastCrash,
    };
  }

  logs(name: string, sinceSeq: number): LogLine[] {
    const entry = this.entries.get(name);
    return entry ? entry.logs.filter((l) => l.seq > sinceSeq) : [];
  }

  /** Synchronous so it can run inside `process.on('exit')`. */
  killAll(): void {
    for (const entry of this.entries.values()) {
      this.clearRelaunch(entry);
      const run = entry.run;
      if (run && !run.settled) {
        run.stopRequested = true;
        if (!run.exited) killTreeSync(run.pid);
        this.settleStopped(entry, run);
      } else {
        entry.status = 'stopped';
      }
    }
    this.writePidFile();
  }

  /**
   * Kills processes recorded by a previous run. A recorded pid is only trusted when the live process
   * was created when we recorded it, so a reused pid (reboot, stale pid file) is never killed.
   */
  cleanupOrphans(): void {
    let recorded: Record<string, unknown>;
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(this.pidFile).mtimeMs;
      recorded = JSON.parse(fs.readFileSync(this.pidFile, 'utf8'));
    } catch {
      return;
    }
    const bootTime = Date.now() - os.uptime() * 1000;
    if (mtimeMs >= bootTime && recorded && typeof recorded === 'object') {
      const ours = new Set<number>([process.pid]);
      for (const entry of this.entries.values()) if (entry.run) ours.add(entry.run.pid);
      const candidates: { pid: number; startedAt: number }[] = [];
      for (const value of Object.values(recorded)) {
        const v = value as { pid?: unknown; startedAt?: unknown } | null;
        if (v && isValidPid(v.pid) && typeof v.startedAt === 'number' && !ours.has(v.pid)) {
          candidates.push({ pid: v.pid, startedAt: v.startedAt });
        }
      }
      const live = readStartTimes(candidates.map((c) => c.pid));
      for (const { pid, startedAt } of candidates) {
        const created = live.get(pid);
        if (created !== undefined && Math.abs(created - startedAt) <= START_TIME_TOLERANCE_MS) killTreeSync(pid);
      }
    }
    this.writePidFile();
  }

  // --- internals -----------------------------------------------------------

  private entry(name: string): Entry {
    let entry = this.entries.get(name);
    if (!entry) {
      entry = {
        name, spec: null, env: {}, status: 'stopped', run: null, logs: [], seq: 0, restarts: 0,
        crashTimes: [], lastCrash: null, relaunchTimer: null,
      };
      this.entries.set(name, entry);
    }
    return entry;
  }

  private clearRelaunch(entry: Entry): void {
    if (entry.relaunchTimer) clearTimeout(entry.relaunchTimer);
    entry.relaunchTimer = null;
  }

  private clearStable(run: Run): void {
    if (run.stableTimer) clearTimeout(run.stableTimer);
    run.stableTimer = null;
  }

  private push(entry: Entry, stream: LogLine['stream'], raw: string): void {
    const text = stripAnsi(raw).trimEnd();
    if (!text.trim()) return;
    entry.logs.push({ seq: ++entry.seq, ts: Date.now(), stream, text });
    if (entry.logs.length > this.maxLogLines) entry.logs.splice(0, entry.logs.length - this.maxLogLines);
  }

  private launch(entry: Entry): void {
    const spec = entry.spec!;
    let child: ChildProcess;
    try {
      child = spawn(spec.command, {
        cwd: spec.cwd,
        env: { ...process.env, ...entry.env },
        shell: true,
        detached: !IS_WINDOWS,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.push(entry, 'sys', `✖ Impossible de lancer le process : ${(err as Error).message}`);
      entry.status = 'failed';
      return;
    }

    let resolveExit!: () => void;
    let resolveSettled!: () => void;
    const closed = [child.stdout!, child.stderr!].map(
      (s) => new Promise<void>((resolve) => s.once('close', resolve)),
    );
    const run: Run = {
      child,
      pid: child.pid ?? -1,
      startedAt: Date.now(),
      exited: false,
      stopRequested: false,
      settled: false,
      exitPromise: new Promise<void>((r) => (resolveExit = r)),
      settledPromise: new Promise<void>((r) => (resolveSettled = r)),
      resolveExit: () => resolveExit(),
      resolveSettled: () => resolveSettled(),
      drained: Promise.all(closed).then(() => undefined),
      stableTimer: null,
    };
    entry.run = run;
    entry.status = 'running';
    this.writePidFile();

    readline.createInterface({ input: child.stdout! }).on('line', (l) => this.push(entry, 'out', l));
    readline.createInterface({ input: child.stderr! }).on('line', (l) => this.push(entry, 'err', l));

    if (this.stableMs >= 0) {
      run.stableTimer = setTimeout(() => {
        if (entry.run === run && !run.exited) entry.lastCrash = null;
      }, this.stableMs);
      run.stableTimer.unref();
    }

    child.once('error', (err) => {
      this.push(entry, 'sys', `✖ Erreur de lancement : ${err.message}`);
      this.onExit(entry, run, null);
    });
    child.once('exit', (code) => this.onExit(entry, run, code));
  }

  private onExit(entry: Entry, run: Run, exitCode: number | null): void {
    if (run.exited) return;
    run.exited = true;
    this.clearStable(run);
    this.writePidFile();
    run.resolveExit();

    if (run.stopRequested) {
      this.settleStopped(entry, run);
      return;
    }
    // Unrequested exit: let the pipes drain so the crash tail is complete.
    void Promise.race([run.drained, new Promise((r) => setTimeout(r, DRAIN_TIMEOUT_MS))]).then(() => {
      if (run.settled || entry.run !== run) return;
      if (run.stopRequested) this.settleStopped(entry, run);
      else this.handleCrash(entry, run, exitCode);
    });
  }

  private settleStopped(entry: Entry, run: Run): void {
    run.settled = true;
    this.clearStable(run);
    if (entry.run === run) {
      entry.run = null;
      entry.status = 'stopped';
    }
    run.resolveSettled();
  }

  private handleCrash(entry: Entry, run: Run, exitCode: number | null): void {
    run.settled = true;
    entry.run = null;

    const now = Date.now();
    const errTail = entry.logs.filter((l) => l.stream === 'err').slice(-CRASH_TAIL_LINES);
    const tailLines = errTail.length > 0 ? errTail : entry.logs.filter((l) => l.stream === 'out').slice(-CRASH_TAIL_LINES);
    entry.lastCrash = { at: now, exitCode, tail: tailLines.map((l) => l.text) };

    entry.crashTimes = [...entry.crashTimes.filter((t) => now - t < this.crashWindowMs), now];
    if (entry.crashTimes.length >= this.crashLimit) {
      entry.status = 'failed';
      this.push(entry, 'sys', `✖ ${this.crashLimit} plantages en ${this.crashWindowMs / 1000} s — relance automatique arrêtée`);
      run.resolveSettled();
      return;
    }

    const delay = this.backoffMs(entry.crashTimes.length);
    entry.status = 'restarting';
    this.push(entry, 'sys', `✖ Planté (code ${exitCode ?? 'inconnu'}) — relance dans ${formatDelay(delay)}`);
    entry.relaunchTimer = setTimeout(() => {
      entry.relaunchTimer = null;
      entry.restarts++;
      this.launch(entry);
    }, delay);
    run.resolveSettled();
  }

  private writePidFile(): void {
    const pids: Record<string, { pid: number; startedAt: number }> = {};
    for (const entry of this.entries.values()) {
      const run = entry.run;
      if (run && !run.exited && isValidPid(run.pid)) pids[entry.name] = { pid: run.pid, startedAt: run.startedAt };
    }
    try {
      fs.mkdirSync(path.dirname(this.pidFile), { recursive: true });
      fs.writeFileSync(this.pidFile, JSON.stringify(pids), 'utf8');
    } catch {
      // The pid file is a best-effort safety net; never take the manager down for it.
    }
  }
}
