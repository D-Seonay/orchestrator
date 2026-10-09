import { spawn, exec, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { AppConfig, AppStats } from '@/types';
import { formatUptime, parseEnvFile, stripAnsi } from '@/lib/utils';

const CONFIG_PATH = path.join(/*turbopackIgnore: true*/ process.cwd(), 'apps.config.json');
const MAX_LOG_LINES = 100;

const BUILD_PATTERNS = /building\.\.\.|rebuilding\.\.\.|compiling|webpack is (watching|compiling)/i;
const READY_PATTERNS = /compiled successfully|compiled with warnings|ready|listening on|server started|application running|started server|watching for/i;

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
  buildState?: 'building' | 'ready';
  crashTimes: number[];
  circuitOpen: boolean;
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

function killProcess(child: ChildProcess | null): void {
  if (!child || child.killed) return;
  const pid = child.pid;
  if (process.platform === 'win32' && pid) {
    exec(`taskkill /pid ${pid} /T /F`, (err) => {
      if (err && !child.killed) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    });
  } else {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
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

function updateAllResourceUsage(): void {
  const nodePids: { name: string; pid: number }[] = [];
  const dockerApps: string[] = [];

  S.appsConfig.forEach(app => {
    const state = S.processes.get(app.name);
    if (!state) return;

    if (state.config.type === 'docker') {
      dockerApps.push(app.name);
    } else if (state.child && !state.child.killed && state.child.pid) {
      nodePids.push({ name: app.name, pid: state.child.pid });
    } else {
      state.resources = { cpu: '0%', ram: '0MB' };
    }
  });

  // Query Docker stats for any containerized apps
  dockerApps.forEach(name => {
    const state = S.processes.get(name);
    if (!state) return;
    const containerName = `dashboard-${name}`;
    const cmd = `docker stats ${containerName} --no-stream --format "{{.CPUPerc}},{{.MemUsage}}"`;
    exec(cmd, (err, stdout) => {
      if (err || !stdout) {
        state.resources = { cpu: '0%', ram: '0MB' };
        return;
      }
      const [cpu, mem] = stdout.split(',');
      state.resources = { cpu: cpu?.trim() || '0%', ram: mem?.split(' / ')[0]?.trim() || '0MB' };
    });
  });

  if (nodePids.length === 0) return;

  if (process.platform === 'win32') {
    // Single batched PowerShell query for all active Node PIDs
    const pidsList = nodePids.map(p => p.pid).join(',');
    const cmd = `powershell.exe -NoProfile -Command "@(Get-Process -Id ${pidsList} -ErrorAction SilentlyContinue | Select-Object Id, WorkingSet64, CPU) | ConvertTo-Json -Compress"`;
    exec(cmd, (err, stdout) => {
      if (err || !stdout) return;
      try {
        const parsed = JSON.parse(stdout);
        const list: { Id?: number; WorkingSet64?: number; CPU?: number | null }[] = Array.isArray(parsed) ? parsed : [parsed];
        const byPid = new Map<number, { WorkingSet64: number; CPU: number }>();
        list.forEach(item => {
          if (item?.Id) {
            byPid.set(item.Id, { WorkingSet64: item.WorkingSet64 || 0, CPU: item.CPU ?? 0 });
          }
        });

        const now = Date.now();
        nodePids.forEach(({ name, pid }) => {
          const state = S.processes.get(name);
          if (!state) return;
          const info = byPid.get(pid);
          if (!info) {
            state.resources = { cpu: '0%', ram: '0MB' };
            return;
          }

          const ram = `${(info.WorkingSet64 / 1024 / 1024).toFixed(1)}MB`;
          const totalCpuMs = (info.CPU || 0) * 1000;

          if (state.lastUsage) {
            const timeDiff = now - state.lastUsage.time;
            const cpuDiff = totalCpuMs - state.lastUsage.cpuTime;
            const cpuPercent = timeDiff > 0 ? Math.max(0, (cpuDiff / timeDiff) * 100) : 0;
            state.resources = { cpu: `${cpuPercent.toFixed(1)}%`, ram };
          } else {
            state.resources = { cpu: '...', ram };
          }
          state.lastUsage = { time: now, cpuTime: totalCpuMs };
        });
      } catch {
        // ignore parse error
      }
    });
  }
}

function ensureState(config: AppConfig): ProcessState {
  const existing = S.processes.get(config.name);
  if (existing) {
    existing.config = config;
    return existing;
  }

  const state: ProcessState = {
    config,
    child: null,
    shouldRun: false,
    manualRestart: false,
    restarts: 0,
    startTime: null,
    logs: [],
    git: { branch: '...', dirty: false, sync: '' },
    resources: { cpu: '0%', ram: '0MB' },
    crashTimes: [],
    circuitOpen: false,
  };
  S.processes.set(config.name, state);
  return state;
}

function startProcess(config: AppConfig): void {
  ensureState(config);
  const state = S.processes.get(config.name)!;
  
  state.shouldRun = true;
  state.restarts = state.startTime ? state.restarts + 1 : state.restarts;
  state.startTime = Date.now();
  state.manualRestart = false;
  state.buildState = undefined;
  state.circuitOpen = false;

  const addLog = (raw: string) => {
    const msg = stripAnsi(raw).trim();
    if (!msg) return;
    const timestamp = new Date().toLocaleTimeString();
    state.logs.push(`[${timestamp}] ${msg}`);
    if (state.logs.length > MAX_LOG_LINES) state.logs.shift();
    if (BUILD_PATTERNS.test(msg)) state.buildState = 'building';
    else if (READY_PATTERNS.test(msg)) state.buildState = 'ready';
  };

  if (config.type === 'docker') {
    state.buildState = 'building';
    const containerName = `dashboard-${config.name}`;
    const dockerfilePath = config.dockerfile || config.script || 'Dockerfile';
    
    // 1. Build
    addLog(`DOCKER: Building image dashboard-${config.name}...`);
    const build = spawn('docker', ['build', '-t', containerName, '-f', dockerfilePath, '.'], {
      cwd: config.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    readline.createInterface({ input: build.stdout! }).on('line', line => addLog(line));
    readline.createInterface({ input: build.stderr! }).on('line', line => addLog(`BUILD ERR: ${line}`));

    build.on('exit', (code) => {
      if (code !== 0) {
        addLog(`DOCKER: Build failed with code ${code}`);
        state.buildState = undefined;
        S.processes.set(config.name, { ...state, child: null });
        return;
      }

      addLog(`DOCKER: Build successful. Starting container...`);
      state.buildState = 'ready';

      // 2. Run
      const envFilePath = path.join(config.cwd || process.cwd(), '.env');
      const namedEnvPath = path.join(/*turbopackIgnore: true*/ process.cwd(), `.env.${config.name}`);
      const dotEnv = parseEnvFile(fs.existsSync(envFilePath) ? envFilePath : namedEnvPath);
      const combinedEnv = { ...dotEnv, ...(config.env ?? {}) };

      const runArgs = ['run', '--rm', '--name', containerName];
      Object.entries(combinedEnv).forEach(([k, v]) => {
        runArgs.push('-e', `${k}=${v}`);
      });
      (config.ports || []).forEach(p => {
        runArgs.push('-p', p);
      });
      runArgs.push(containerName);

      const child = spawn('docker', runArgs, {
        cwd: config.cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      state.child = child;
      S.processes.set(config.name, state);

      readline.createInterface({ input: child.stdout! }).on('line', line => addLog(line));
      readline.createInterface({ input: child.stderr! }).on('line', line => addLog(`STDERR: ${line}`));

      child.on('exit', (_code, signal) => handleExit(config.name, child, signal));
    });

    S.processes.set(config.name, state);
    return;
  }

  // Node.js implementation
  const envFilePath = path.join(config.cwd || process.cwd(), '.env');
  const namedEnvPath = path.join(/*turbopackIgnore: true*/ process.cwd(), `.env.${config.name}`);
  const dotEnv = parseEnvFile(
    fs.existsSync(envFilePath) ? envFilePath : namedEnvPath
  );

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

  readline.createInterface({ input: child.stdout! }).on('line', line => addLog(line));
  readline.createInterface({ input: child.stderr! }).on('line', line => addLog(`STDERR: ${line}`));

  child.on('exit', (_code, signal) => handleExit(config.name, child, signal));
}

function handleExit(name: string, child: ChildProcess, signal: string | null): void {
  const currentState = S.processes.get(name);
  if (!currentState || currentState.child !== child) return;

  const isManual = currentState.manualRestart;
  const isExplicitKill = signal === 'SIGTERM' || signal === 'SIGKILL' || !currentState.shouldRun;
  const isCrash = currentState.shouldRun && !isManual && !isExplicitKill;

  const now = Date.now();
  const WINDOW_MS = 60_000;
  const CRASH_THRESHOLD = 5;

  let crashTimes = currentState.crashTimes ?? [];
  let circuitOpen = currentState.circuitOpen ?? false;

  if (isCrash && !circuitOpen) {
    crashTimes = [...crashTimes.filter(t => now - t < WINDOW_MS), now];
    if (crashTimes.length >= CRASH_THRESHOLD) {
      circuitOpen = true;
    }
  }

  const newState = { ...currentState, child: null, resources: { cpu: '0%', ram: '0MB' }, crashTimes, circuitOpen };
  S.processes.set(name, newState);

  if (circuitOpen && isCrash) {
    const ts = new Date().toLocaleTimeString();
    newState.logs.push(`[${ts}] ⚡ CIRCUIT BREAKER: ${crashTimes.length} crashes en 60s — redémarrage automatique suspendu. Reset manuel requis.`);
    if (newState.logs.length > MAX_LOG_LINES) newState.logs.shift();
    return;
  }

  if (currentState.shouldRun && (isManual || !isExplicitKill)) {
    // Exponential backoff: 1.5s, 3s, 6s... capped at 10s. 500ms on manual restart
    const delay = isManual
      ? 500
      : Math.min(1500 * Math.pow(2, Math.max(0, crashTimes.length - 1)), 10000);
    setTimeout(() => startProcess(currentState.config), delay);
  }
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
    
    S.appsConfig.forEach(app => {
      ensureState(app);
      
      const isDocker = app.type === 'docker';
      const shouldAutoStart = app.autoStart !== undefined ? app.autoStart : !isDocker;
      
      if (shouldAutoStart) {
        startProcess(app);
      }
    });

    // Batched resource metrics every 5 seconds
    setInterval(() => {
      updateAllResourceUsage();
    }, 5000);

    // Git info every 15 seconds
    setInterval(() => {
      S.appsConfig.forEach(app => {
        updateGitInfo(app.name);
      });
    }, 15000);
  },

  start(name: string): void {
    const state = S.processes.get(name);
    if (state) {
      state.shouldRun = true;
      state.circuitOpen = false;
      state.crashTimes = [];
      if (!state.child || state.child.killed) startProcess(state.config);
    }
  },

  stop(name: string): void {
    const state = S.processes.get(name);
    if (state) {
      state.shouldRun = false;
      if (state.config.type === 'docker') {
        exec(`docker stop dashboard-${name}`);
      } else {
        killProcess(state.child);
      }
    }
  },

  restart(name: string): void {
    const state = S.processes.get(name);
    if (state) {
      state.shouldRun = true;
      state.circuitOpen = false;
      state.crashTimes = [];
      if (state.config.type === 'docker') {
        state.manualRestart = true;
        exec(`docker stop dashboard-${name}`);
      } else if (state.child) {
        state.manualRestart = true;
        killProcess(state.child);
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
        killProcess(oldState.child);
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
        group: app.group,
        status: (state.buildState === 'building' ? 'Building'
          : isOnline ? 'Online'
          : state.circuitOpen ? 'Crashed'
          : state.shouldRun ? 'Restarting' : 'Stopped') as AppStats['status'],
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

  startGroup(group: string): void {
    S.appsConfig.filter(a => a.group === group).forEach(a => this.start(a.name));
  },

  stopGroup(group: string): void {
    S.appsConfig.filter(a => a.group === group).forEach(a => this.stop(a.name));
  },

  restartGroup(group: string): void {
    S.appsConfig.filter(a => a.group === group).forEach(a => this.restart(a.name));
  },

  gitPull(name: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const state = S.processes.get(name);
      const cwd = state?.config.cwd || process.cwd();
      exec('git pull', { cwd }, (err, stdout, stderr) => {
        const output = stripAnsi((stdout || stderr || '').trim());
        const currentState = S.processes.get(name);
        if (currentState) {
          const timestamp = new Date().toLocaleTimeString();
          currentState.logs.push(`[${timestamp}] GIT: ${output}`);
          if (currentState.logs.length > MAX_LOG_LINES) currentState.logs.shift();
        }
        if (err) reject(new Error(output || err.message));
        else resolve(output);
      });
    });
  },
};
