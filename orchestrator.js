const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const http = require('http');
const url = require('url');

const configPath = path.join(__dirname, 'apps.config.json');
let appsConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

function saveConfig() {
  const tempPath = `${configPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(appsConfig, null, 2), 'utf8');
  fs.renameSync(tempPath, configPath);
}

const processes = new Map();
let isShuttingDown = false;
const startTime = Date.now();
const WEB_PORT = 4444;
const MAX_LOG_LINES = 100;

// --- Utils ---
const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');

function formatUptime(seconds) {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  } else if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// --- Logique Environnement (.env) ---
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const env = {};
    content.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index === -1) return;
      const key = trimmed.substring(0, index).trim();
      let value = trimmed.substring(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      env[key] = value;
    });
    return env;
  } catch (err) { return {}; }
}

// --- Logique Ressources (CPU/RAM) ---
function updateResourceUsage(name) {
  const state = processes.get(name);
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
        const cpuPercent = ((cpuDiff / timeDiff) * 100).toFixed(1);
        state.resources = { cpu: `${cpuPercent}%`, ram };
      } else { state.resources = { cpu: '...', ram }; }
      state.lastUsage = { time: now, cpuTime: totalTime };
    } catch (e) {}
  });
}

// --- Logique Git ---
function updateGitInfo(name) {
  const state = processes.get(name);
  if (!state || !state.config.cwd) return;
  const cwd = state.config.cwd;
  const cmd = 'git rev-parse --abbrev-ref HEAD && git status --porcelain && git rev-list --left-right --count HEAD...@{u}';
  exec(cmd, { cwd }, (err, stdout) => {
    if (err) { state.git = { branch: 'N/A', dirty: false, sync: '' }; return; }
    const lines = stdout.split('\n');
    const branch = (lines[0] || '').trim();
    if (!branch) return;
    const porcelain = stdout.split(branch)[1] || '';
    const statusLines = porcelain.split('\n').filter(l => l.trim().length > 0);
    const isDirty = statusLines.some(l => !l.match(/^\d+\t\d+$/));
    let sync = '';
    const syncLine = statusLines.find(l => l.match(/^\d+\t\d+$/));
    if (syncLine) {
      const [ahead, behind] = syncLine.trim().split('\t').map(Number);
      if (ahead > 0) sync += ` ⬆️${ahead}`;
      if (behind > 0) sync += ` ⬇️${behind}`;
    }
    state.git = { branch, dirty: isDirty, sync: sync.trim() };
  });
}

// --- Stats Helpers ---
function getAppStats(name) {
  const procState = processes.get(name);
  if (!procState) return null;
  const isOnline = procState.child && !procState.child.killed;
  const uptime = isOnline && procState.startTime ? Math.floor((Date.now() - procState.startTime) / 1000) : 0;
  
  return {
    name,
    status: isOnline ? 'Online' : (procState.shouldRun ? 'Restarting' : 'Stopped'),
    restarts: procState.restarts || 0,
    uptime: formatUptime(uptime),
    cpu: procState.resources?.cpu || '0%',
    ram: procState.resources?.ram || '0MB',
    git: procState.git || { branch: '-', dirty: false, sync: '' },
    shouldRun: procState.shouldRun,
    logs: procState.logs || []
  };
}

// --- Dashboard CLI ---
function renderDashboard() {
  if (isShuttingDown) return;
  process.stdout.write('\x1b[s\x1b[H'); 
  process.stdout.write('\x1b[1m\x1b[36m🚀 ORCHESTRATOR LIVE \x1b[0m | \x1b[2mhttp://localhost:' + WEB_PORT + '\x1b[0m\x1b[K\n');
  process.stdout.write(`Uptime: ${formatUptime(Math.floor((Date.now() - startTime) / 1000))}\x1b[K\n\n`);
  const head = 'PROJECT'.padEnd(20) + 'STATUS'.padEnd(10) + 'UPTIME'.padEnd(12) + 'CPU/RAM'.padEnd(16) + 'GIT'.padEnd(12) + 'RESTARTS';
  process.stdout.write('\x1b[1m\x1b[37m' + head + '\x1b[0m\x1b[K\n');
  process.stdout.write('\x1b[90m' + '─'.repeat(80) + '\x1b[0m\x1b[K\n');
  for (const app of appsConfig) {
    const s = getAppStats(app.name);
    if (!s) continue;
    const color = s.status === 'Online' ? '32' : (s.shouldRun ? '33' : '31');
    const status = `\x1b[${color}m${s.status.padEnd(10)}\x1b[0m`;
    const uptime = s.uptime.padEnd(12);
    const res = `\x1b[34m${s.cpu.split('%')[0]}%\x1b[0m/\x1b[35m${s.ram}\x1b[0m`.padEnd(25); 
    const git = `\x1b[33m${s.git.branch}${s.git.dirty ? '*' : ''}\x1b[0m`.padEnd(22); 
    
    const nameStr = s.name.padEnd(20);
    const restartsStr = String(s.restarts).padStart(8);
    
    process.stdout.write(nameStr + status + uptime + res + git + restartsStr + '\x1b[K\n');
  }
  process.stdout.write('\x1b[90m' + '─'.repeat(80) + '\x1b[0m\x1b[K\n');
  process.stdout.write('\x1b[2mCommands: start/stop/restart [name] | git | list\x1b[0m\x1b[K\n\x1b[u'); 
}

// --- Serveur Web Dashboard ---
const DIST_PATH = path.join(__dirname, 'dashboard', 'dist');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  const reqUrl = url.parse(req.url, true);
  const pathname = reqUrl.pathname;
  console.log(`Request: ${pathname}`);
  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ 
        apps: appsConfig.map(a => getAppStats(a.name)),
        masterUptime: formatUptime(Math.floor((Date.now() - startTime) / 1000))
      }));
    }

    if (pathname === '/api/action') {
      const { app, action } = reqUrl.query;
      if (action === 'restart-all') appsConfig.forEach(a => restartApp(a.name));
      else if (action === 'restart') restartApp(app);
      else if (action === 'stop') stopApp(app);
      else if (action === 'start') { const c = appsConfig.find(a => a.name === app); if (c) startApp(c); }
      res.writeHead(200); return res.end('OK');
    }

    // Project Management API
    if (pathname === '/api/apps') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(appsConfig));
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const newApp = JSON.parse(body);
            if (!newApp.name || !newApp.script) {
              res.writeHead(400); return res.end('Missing name or script');
            }
            if (appsConfig.find(a => a.name === newApp.name)) {
              res.writeHead(400); return res.end('App already exists');
            }
            if (newApp.cwd && !fs.existsSync(newApp.cwd)) {
              res.writeHead(400); return res.end('CWD path does not exist');
            }
            const checkCwd = newApp.cwd || process.cwd();
            if (newApp.script && !fs.existsSync(path.resolve(checkCwd, newApp.script))) {
              res.writeHead(400); return res.end('Script path does not exist');
            }
            appsConfig.push(newApp);
            saveConfig();
            startApp(newApp);
            res.writeHead(201); res.end('Created');
          } catch (e) {
            res.writeHead(400); res.end('Invalid JSON');
          }
        });
        return;
      }
    }

    const appMatch = pathname.match(/^\/api\/apps\/(.+)$/);
    if (appMatch) {
      const appName = decodeURIComponent(appMatch[1]);
      const appIndex = appsConfig.findIndex(a => a.name === appName);

      if (appIndex !== -1) {
        if (req.method === 'PATCH') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const updates = JSON.parse(body);
              
              if (updates.name && updates.name !== appName && appsConfig.find(a => a.name === updates.name)) {
                res.writeHead(400); return res.end('App name already exists');
              }

              const currentApp = appsConfig[appIndex];
              const finalCwd = (updates.cwd !== undefined ? updates.cwd : currentApp.cwd) || process.cwd();
              if (updates.cwd && !fs.existsSync(updates.cwd)) {
                res.writeHead(400); return res.end('CWD path does not exist');
              }

              const checkScript = updates.script !== undefined ? updates.script : currentApp.script;
              if (checkScript && !fs.existsSync(path.resolve(finalCwd, checkScript))) {
                res.writeHead(400); return res.end('Script path does not exist');
              }

              const isRename = updates.name && updates.name !== appName;
              
              appsConfig[appIndex] = { ...appsConfig[appIndex], ...updates };
              saveConfig();

              if (isRename) {
                const oldState = processes.get(appName);
                if (oldState) {
                  const wasRunning = oldState.shouldRun;
                  
                  // Stop the old process and ensure it doesn't restart
                  oldState.shouldRun = false;
                  if (oldState.child) oldState.child.kill('SIGTERM');
                  
                  // Migrate the state to the new name so logs, restarts are preserved
                  const newState = {
                    ...oldState,
                    config: appsConfig[appIndex],
                    shouldRun: wasRunning,
                    child: null,
                    restarts: wasRunning ? oldState.restarts - 1 : oldState.restarts // startApp will increment
                  };
                  
                  processes.set(updates.name, newState);
                  processes.delete(appName);

                  if (wasRunning) {
                    startApp(appsConfig[appIndex]);
                    // Restore original startTime that startApp just overwrote
                    processes.get(updates.name).startTime = oldState.startTime;
                  }
                }
              } else {
                const state = processes.get(appName);
                if (state) {
                  state.config = appsConfig[appIndex];
                  restartApp(appName);
                }
              }

              res.writeHead(200); res.end('Updated');
            } catch (e) {
              res.writeHead(400); res.end('Invalid JSON');
            }
          });
          return;
        }
        if (req.method === 'DELETE') {
          stopApp(appName);
          appsConfig.splice(appIndex, 1);
          processes.delete(appName);
          saveConfig();
          res.writeHead(200); res.end('Deleted');
          return;
        }
      }
    }
    
    // Fallback for non-existent API routes
    res.writeHead(404);
    return res.end(JSON.stringify({ error: 'API route not found' }));
  }

  // --- Static Files & SPA Routing ---
  const normalizedPath = path.normalize(pathname);
  let filePath = path.join(DIST_PATH, normalizedPath === '\\' || normalizedPath === '/' ? 'index.html' : normalizedPath);

  // Security check: ensure the resulting path is within DIST_PATH
  if (!filePath.startsWith(DIST_PATH)) {
    filePath = path.join(DIST_PATH, 'index.html');
  }

  // Handle Single Page Application (SPA) routing: if file doesn't exist, serve index.html
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_PATH, 'index.html');
  }

  // Final check: if even index.html is missing, return 404
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not Found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end(`Server Error: ${err.code}`);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(WEB_PORT, () => process.stdout.write('\n'.repeat(appsConfig.length + 10)));

function stopApp(name) {
  const state = processes.get(name);
  if (state) {
    state.shouldRun = false;
    if (state.child) state.child.kill('SIGTERM');
  }
}

function restartApp(name) {
  const state = processes.get(name);
  if (state) {
    state.shouldRun = true;
    if (state.child) { state.manualRestart = true; state.child.kill('SIGTERM'); } 
    else { startApp(state.config); }
  }
}

function startApp(config) {
  const existingState = processes.get(config.name) || { restarts: -1, logs: [], git: { branch: '...', dirty: false, sync: '' }, resources: { cpu: '0%', ram: '0MB' } };
  const envFilePath = path.join(config.cwd || process.cwd(), '.env');
  const dotEnv = parseEnvFile(fs.existsSync(envFilePath) ? envFilePath : path.join(process.cwd(), `${config.name}.env`));
  const newState = { ...existingState, shouldRun: true, restarts: existingState.restarts + 1, startTime: Date.now(), manualRestart: false, config };
  
  const args = config.args ? [config.script, ...(Array.isArray(config.args) ? config.args : config.args.split(' '))] : [config.script];
  const child = spawn(process.execPath, args, { cwd: config.cwd || process.cwd(), env: { ...process.env, ...dotEnv, ...config.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  newState.child = child;
  processes.set(config.name, newState);
  updateGitInfo(config.name);

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    newState.logs.push(`[${timestamp}] ${msg}`);
    if (newState.logs.length > MAX_LOG_LINES) newState.logs.shift();
  };

  const prefix = `\x1b[32m[${config.name}]\x1b[0m`;
  readline.createInterface({ input: child.stdout }).on('line', (line) => { console.log(`${prefix} ${line}`); addLog(line); });
  readline.createInterface({ input: child.stderr }).on('line', (line) => { console.error(`\x1b[31m[${config.name}]\x1b[0m ${line}`); addLog(`ERROR: ${line}`); });
  
  child.on('exit', (code, signal) => {
    const currentState = processes.get(config.name);
    if (!currentState || currentState.child !== child) return;
    processes.set(config.name, { ...currentState, child: null, resources: { cpu: '0%', ram: '0MB' } });
    if (!isShuttingDown && currentState.shouldRun && (currentState.manualRestart || (signal !== 'SIGTERM' && signal !== 'SIGKILL'))) {
      setTimeout(() => startApp(currentState.config), currentState.manualRestart ? 500 : 1500);
    }
  });
}

appsConfig.forEach(startApp);
setInterval(renderDashboard, 2000);
setInterval(() => appsConfig.forEach(app => { updateGitInfo(app.name); updateResourceUsage(app.name); }), 5000);

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => { 
  const input = line.trim();
  const [cmd, name] = input.split(' ');
  if (input === 'list') renderDashboard();
  else if (input === 'git') appsConfig.forEach(app => updateGitInfo(app.name));
  else if (cmd === 'stop' && name) stopApp(name);
  else if (cmd === 'start' && name) { const c = appsConfig.find(a => a.name === name); if (c) startApp(c); }
  else if (cmd === 'restart' && name) restartApp(name);
  else if (processes.has(input)) restartApp(input);
});

const shutdown = () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n\x1b[31m[Master] Stopping...\x1b[0m');
  server.close();
  for (const [name, state] of processes) if (state.child) state.child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1000);
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); process.on('SIGBREAK', shutdown);
