import { spawn, exec, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { AppConfig, AppStats } from '@/types';
import { formatUptime, parseEnvFile } from '@/lib/utils';

const CONFIG_PATH = path.join(process.cwd(), 'apps.config.json');
const MAX_LOG_LINES = 100;

interface ProcessState {
  config: AppConfig;
  child: ChildProcess | null;
  shouldRun: boolean;
  manualRestart: boolean;
  restarts: number;
  startTime: number | null;
  logs: string[];
  git: { branch: string; dirty: boolean; sync: string };
  resources: { cpu: string; ram: string };
  lastUsage?: { time: number; cpuTime: number };
}

// Global state survives Next.js hot reloads and module isolation between
// instrumentation.ts and API route handlers in development.
const g = globalThis as typeof globalThis & {
  __orch?: {
    appsConfig: AppConfig[];
    processes: Map<string, ProcessState>;
    masterStartTime: number;
    initialized: boolean;
  };
};
if (!g.__orch) {
  g.__orch = {
    appsConfig: [],
    processes: new Map(),
    masterStartTime: Date.now(),
    initialized: false,
  };
}
const S = g.__orch;

function saveConfig(): void {
  const tempPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(S.appsConfig, null, 2), 'utf8');
  fs.renameSync(tempPath, CONFIG_PATH);
}

function updateGitInfo(name: string): void {
  const state = S.processes.get(name);
  if (!state || !state.config.cwd) return;
  const cmd = 'git rev-parse --abbrev-ref HEAD && git status --porcelain && git rev-list --left-right --count HEAD...@{u}';
  exec(cmd, { cwd: state.config.cwd }, (err, stdout) => {
    if (err) { state.git = { branch: 'N/A', dirty: false, sync: '' }; return; }
    const lines = stdout.split('\n');
    const branch = (lines[0] || '').trim();
    if (!branch) return;
    const firstNewline = stdout.indexOf('\n');
    const porcelain = firstNewline !== -1 ? stdout.slice(firstNewline + 1) : '';
    const statusLines = porcelain.split('\n').filter(l => l.trim().length > 0);
    const isDirty = statusLines.some(l => !l.match(/^\d+\t\d+$/));
    let sync = '';
    const syncLine = statusLines.find(l => l.match(/^\d+\t\d+$/));
    if (syncLine) {
      const [ahead, behind] = syncLine.trim().split('\t').map(Number);
      if (ahead > 0) sync += `⬆${ahead}`;
      if (behind > 0) sync += ` ⬇${behind}`;
    }
    state.git = { branch, dirty: isDirty, sync: sync.trim() };
  });
}

function updateResourceUsage(name: string): void {
  const state = S.processes.get(name);
  if (!state || !state.child || state.child.killed || !state.child.pid) {
    if (state) state.resources = { cpu: '0%', ram: '0MB' };
    return;
  }
  const pid = state.child.pid;
  const cmd = `powershell.exe -NoProfile -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object WorkingSet64, @{Name='TotalProcessorTime';Expression={$_.UserProcessorTime.TotalMilliseconds + $_.PrivilegedProcessorTime.TotalMilliseconds}} | ConvertTo-Json"`;
  exec(cmd, (err, stdout) => {
    if (err || !stdout) return;
    try {
      const data = JSON.parse(stdout);
      if (!data) return;
      const ram = data.WorkingSet64 ? `${(parseInt(data.WorkingSet64) / 1024 / 1024).toFixed(1)}MB` : '0MB';
      const totalTime = parseFloat(data.TotalProcessorTime || 0);
      const now = Date.now();
      if (state.lastUsage) {
        const timeDiff = now - state.lastUsage.time;
        const cpuDiff = totalTime - state.lastUsage.cpuTime;
        state.resources = { cpu: `${((cpuDiff / timeDiff) * 100).toFixed(1)}%`, ram };
      } else {
        state.resources = { cpu: '...', ram };
      }
      state.lastUsage = { time: now, cpuTime: totalTime };
    } catch { /* ignore */ }
  });
}

function startProcess(config: AppConfig): void {
  const existing = S.processes.get(config.name);
  const base = existing ?? {
    restarts: -1,
    logs: [],
    git: { branch: '...', dirty: false, sync: '' },
    resources: { cpu: '0%', ram: '0MB' },
  };

  const envFilePath = path.join(config.cwd || process.cwd(), '.env');
  const namedEnvPath = path.join(process.cwd(), `.env.${config.name}`);
  const dotEnv = parseEnvFile(
    fs.existsSync(envFilePath) ? envFilePath : namedEnvPath
  );

  const state: ProcessState = {
    ...(base as ProcessState),
    config,
    shouldRun: true,
    restarts: (base as ProcessState).restarts + 1,
    startTime: Date.now(),
    manualRestart: false,
  };

  const args = config.args
    ? [config.script, ...(Array.isArray(config.args) ? config.args : config.args.split(' '))]
    : [config.script];

  const child = spawn(process.execPath, args, {
    cwd: config.cwd || process.cwd(),
    env: { ...process.env, ...dotEnv, ...(config.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  state.child = child;
  S.processes.set(config.name, state);
  updateGitInfo(config.name);

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    state.logs.push(`[${timestamp}] ${msg}`);
    if (state.logs.length > MAX_LOG_LINES) state.logs.shift();
  };

  readline.createInterface({ input: child.stdout! }).on('line', line => addLog(line));
  readline.createInterface({ input: child.stderr! }).on('line', line => addLog(`ERROR: ${line}`));

  child.on('exit', (_code, signal) => {
    const currentState = S.processes.get(config.name);
    if (!currentState || currentState.child !== child) return;
    S.processes.set(config.name, { ...currentState, child: null, resources: { cpu: '0%', ram: '0MB' } });
    if (
      currentState.shouldRun &&
      (currentState.manualRestart || (signal !== 'SIGTERM' && signal !== 'SIGKILL'))
    ) {
      setTimeout(() => startProcess(currentState.config), currentState.manualRestart ? 500 : 1500);
    }
  });
}

export const orchestrator = {
  init(): void {
    if (S.initialized) return;
    S.initialized = true;
    try {
      S.appsConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      S.appsConfig = [];
    }
    S.appsConfig.forEach(startProcess);
    setInterval(() => {
      S.appsConfig.forEach(app => {
        updateGitInfo(app.name);
        updateResourceUsage(app.name);
      });
    }, 5000);
  },

  start(name: string): void {
    const state = S.processes.get(name);
    if (state) {
      state.shouldRun = true;
      if (!state.child || state.child.killed) startProcess(state.config);
    }
  },

  stop(name: string): void {
    const state = S.processes.get(name);
    if (state) {
      state.shouldRun = false;
      state.child?.kill('SIGTERM');
    }
  },

  restart(name: string): void {
    const state = S.processes.get(name);
    if (state) {
      state.shouldRun = true;
      if (state.child) {
        state.manualRestart = true;
        state.child.kill('SIGTERM');
      } else {
        startProcess(state.config);
      }
    }
  },

  add(config: AppConfig): void {
    S.appsConfig.push(config);
    saveConfig();
    startProcess(config);
  },

  update(name: string, patch: Partial<AppConfig>): void {
    const index = S.appsConfig.findIndex(a => a.name === name);
    if (index === -1) return;

    const isRename = patch.name && patch.name !== name;
    S.appsConfig[index] = { ...S.appsConfig[index], ...patch };
    saveConfig();

    if (isRename) {
      const oldState = S.processes.get(name);
      if (oldState) {
        const wasRunning = oldState.shouldRun;
        oldState.shouldRun = false;
        oldState.child?.kill('SIGTERM');
        S.processes.set(patch.name!, {
          ...oldState,
          config: S.appsConfig[index],
          shouldRun: wasRunning,
          child: null,
          restarts: wasRunning ? oldState.restarts - 1 : oldState.restarts,
        });
        S.processes.delete(name);
        if (wasRunning) startProcess(S.appsConfig[index]);
      }
    } else {
      const state = S.processes.get(name);
      if (state) {
        state.config = S.appsConfig[index];
        this.restart(name);
      }
    }
  },

  remove(name: string): void {
    this.stop(name);
    S.appsConfig = S.appsConfig.filter(a => a.name !== name);
    S.processes.delete(name);
    saveConfig();
  },

  getStats(): AppStats[] {
    return S.appsConfig.map(app => {
      const state = S.processes.get(app.name);
      if (!state) return null;
      const isOnline = !!state.child && !state.child.killed;
      const uptime = isOnline && state.startTime
        ? Math.floor((Date.now() - state.startTime) / 1000)
        : 0;
      return {
        name: app.name,
        script: app.script,
        args: app.args,
        cwd: app.cwd,
        env: app.env,
        status: (isOnline ? 'Online' : state.shouldRun ? 'Restarting' : 'Stopped') as AppStats['status'],
        restarts: state.restarts || 0,
        uptime: formatUptime(uptime),
        cpu: state.resources?.cpu || '0%',
        ram: state.resources?.ram || '0MB',
        git: state.git || { branch: '-', dirty: false, sync: '' },
        shouldRun: state.shouldRun,
        logs: state.logs || [],
      };
    }).filter(Boolean) as AppStats[];
  },

  getMasterUptime(): string {
    return formatUptime(Math.floor((Date.now() - S.masterStartTime) / 1000));
  },

  getAppsConfig(): AppConfig[] {
    return S.appsConfig;
  },
};
