const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const http = require('http');
const url = require('url');
const appsConfig = require('./apps.config.js');

const processes = new Map();
let isShuttingDown = false;
const startTime = Date.now();
const WEB_PORT = 4444;
const MAX_LOG_LINES = 100;

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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    });
    return env;
  } catch (err) {
    console.error(`[Master] Error parsing .env at ${filePath}:`, err.message);
    return {};
  }
}

// --- Logique Ressources (CPU/RAM) ---
function updateResourceUsage(name) {
  const state = processes.get(name);
  if (!state || !state.child || state.child.killed || !state.child.pid) {
    if (state) state.resources = { cpu: '0%', ram: '0MB' };
    return;
  }

  const pid = state.child.pid;
  // Windows specific: get working set (RAM) and processor time
  const cmd = `wmic process where processid=${pid} get WorkingSetSize,UserModeTime,KernelModeTime /format:list`;
  
  exec(cmd, (err, stdout) => {
    if (err || !stdout) return;
    
    const lines = stdout.split('\n');
    const data = {};
    lines.forEach(l => {
      const [k, v] = l.split('=');
      if (k && v) data[k.trim()] = v.trim();
    });

    const ram = data.WorkingSetSize ? `${(parseInt(data.WorkingSetSize) / 1024 / 1024).toFixed(1)}MB` : '0MB';
    const totalTime = (parseInt(data.UserModeTime || 0) + parseInt(data.KernelModeTime || 0));
    
    // CPU calculation logic
    const now = Date.now();
    if (state.lastUsage) {
      const timeDiff = now - state.lastUsage.time;
      const cpuDiff = totalTime - state.lastUsage.cpuTime;
      // UserModeTime is in 100ns units. 1ms = 10,000 units.
      const cpuPercent = ((cpuDiff / 10000) / timeDiff * 100).toFixed(1);
      state.resources = { cpu: `${cpuPercent}%`, ram };
    } else {
      state.resources = { cpu: '...', ram };
    }
    
    state.lastUsage = { time: now, cpuTime: totalTime };
  });
}

// --- Logique Git ---
function updateGitInfo(name) {
  const state = processes.get(name);
  if (!state || !state.config.cwd) return;

  const cwd = state.config.cwd;
  const cmd = 'git rev-parse --abbrev-ref HEAD && git status --porcelain && git rev-list --left-right --count HEAD...@{u}';
  
  exec(cmd, { cwd }, (err, stdout) => {
    if (err) {
      state.git = { branch: 'N/A', dirty: false, sync: 'no repo' };
      return;
    }

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
    renderDashboard();
  });
}

// --- Logique de suivi des statistiques et logs ---
function getAppStats(name) {
  const procState = processes.get(name);
  if (!procState) return { status: 'Stopped', restarts: 0, uptime: '0s', color: '31', git: { branch: '-', dirty: false, sync: '' }, resources: { cpu: '0%', ram: '0MB' } };
  
  const uptime = procState.child && !procState.child.killed && procState.startTime
    ? Math.floor((Date.now() - procState.startTime) / 1000) 
    : 0;
  
  const uptimeStr = uptime > 60 ? `${Math.floor(uptime/60)}m ${uptime%60}s` : `${uptime}s`;
  const isOnline = procState.child && !procState.child.killed;

  return {
    status: isOnline ? 'Online' : 'Error',
    restarts: procState.restarts || 0,
    uptime: uptimeStr,
    color: isOnline ? '32' : '31',
    logs: procState.logs || [],
    git: procState.git || { branch: '...', dirty: false, sync: '' },
    resources: procState.resources || { cpu: '0%', ram: '0MB' }
  };
}

// --- Dashboard CLI ---
function renderDashboard() {
  if (isShuttingDown) return;
  process.stdout.write('\x1b[s\x1b[H'); 
  process.stdout.write('\x1b[1m\x1b[36m=== ORCHESTRATOR DASHBOARD ===\x1b[0m\x1b[K\n');
  process.stdout.write(`Global Uptime: ${Math.floor((Date.now() - startTime) / 1000)}s | Web UI: http://localhost:${WEB_PORT}\x1b[K\n\n`);
  
  const head = 'NAME'.padEnd(18) + 'STATUS'.padEnd(10) + 'CPU'.padEnd(8) + 'RAM'.padEnd(10) + 'GIT'.padEnd(15) + 'UPTIME';
  process.stdout.write('\x1b[1m' + head + '\x1b[0m\x1b[K\n');
  process.stdout.write('-'.repeat(75) + '\x1b[K\n');
  
  for (const app of appsConfig) {
    const stats = getAppStats(app.name);
    const gitDisplay = `${stats.git.branch}${stats.git.dirty ? '*' : ''}${stats.git.sync}`;
    const statusFormatted = `\x1b[${stats.color}m${stats.status.padEnd(10)}\x1b[0m`;
    
    process.stdout.write(
      app.name.padEnd(18) + 
      statusFormatted + 
      stats.resources.cpu.padEnd(8) + 
      stats.resources.ram.padEnd(10) + 
      gitDisplay.padEnd(15) + 
      stats.uptime + '\x1b[K\n'
    );
  }
  process.stdout.write('-'.repeat(75) + '\x1b[K\n\x1b[2mLogs scroll below. Type app name to restart.\x1b[0m\x1b[K\n\x1b[u'); 
}

// --- Serveur Web Dashboard ---
const server = http.createServer((req, res) => {
  const reqUrl = url.parse(req.url, true);
  const pathname = reqUrl.pathname;

  if (pathname === '/restart-all') {
    for (const app of appsConfig) restartApp(app.name);
    res.writeHead(302, { 'Location': '/' });
    return res.end();
  }

  if (pathname === '/restart') {
    const appName = reqUrl.query.app;
    if (appName) restartApp(appName);
    res.writeHead(302, { 'Location': '/' });
    return res.end();
  }

  if (pathname === '/logs') {
    const appName = reqUrl.query.app;
    const stats = getAppStats(appName);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`
      <html>
        <head><title>Logs - ${appName}</title><style>body{background:#1e1e1e;color:#d4d4d4;font-family:monospace;padding:20px;}.header{position:sticky;top:0;background:#252526;padding:10px;border-bottom:1px solid #333;margin-bottom:15px;display:flex;justify-content:space-between;}a{color:#569cd6;text-decoration:none;font-weight:bold;}.log-line{white-space:pre-wrap;margin-bottom:4px;border-bottom:1px solid #2a2a2a;padding-bottom:2px;}</style></head>
        <body><div class="header"><strong>Logs for ${appName}</strong><div><a href="/">Back</a> | <a href="/logs?app=${appName}">Refresh</a></div></div>
        ${stats.logs.map(l => `<div class="log-line">${l}</div>`).join('')}
        <script>window.scrollTo(0, document.body.scrollHeight);</script></body>
      </html>
    `);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  const rows = appsConfig.map(app => {
    const stats = getAppStats(app.name);
    return `<tr>
      <td style="padding:12px; border-bottom:1px solid #eee">${app.name}</td>
      <td style="padding:12px; border-bottom:1px solid #eee; color: ${stats.status === 'Online' ? '#27ae60' : '#e74c3c'}"><strong>${stats.status}</strong></td>
      <td style="padding:12px; border-bottom:1px solid #eee"><span style="color:#2980b9">${stats.resources.cpu}</span> / <span style="color:#8e44ad">${stats.resources.ram}</span></td>
      <td style="padding:12px; border-bottom:1px solid #eee"><code style="color:${stats.git.dirty ? '#e67e22' : '#7f8c8d'}">${stats.git.branch}${stats.git.dirty ? '*' : ''}</code> <small>${stats.git.sync}</small></td>
      <td style="padding:12px; border-bottom:1px solid #eee">${stats.uptime}</td>
      <td style="padding:12px; border-bottom:1px solid #eee">
        <a href="/restart?app=${app.name}" style="background:#3498db; color:white; padding:5px 10px; text-decoration:none; border-radius:3px; font-size:12px;">Restart</a>
        <a href="/logs?app=${app.name}" style="background:#95a5a6; color:white; padding:5px 10px; text-decoration:none; border-radius:3px; font-size:12px; margin-left:5px;">Logs</a>
      </td>
    </tr>`;
  }).join('');

  res.end(`
    <!DOCTYPE html><html><head><title>Orchestrator Dashboard</title><meta http-equiv="refresh" content="10"><style>body{font-family:'Segoe UI',sans-serif;background:#f8f9fa;padding:40px;}.container{max-width:1200px;margin:auto;background:white;padding:30px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.05);}.header-flex{display:flex;justify-content:space-between;align-items:center;}table{width:100%;border-collapse:collapse;margin-top:20px;}th{text-align:left;background:#f1f3f5;padding:12px;border-bottom:2px solid #dee2e6;}.btn-all{background:#e67e22;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;font-weight:bold;}</style></head>
    <body><div class="container"><div class="header-flex"><h1>🚀 Orchestrator Dashboard</h1><a href="/restart-all" class="btn-all" onclick="return confirm('Restart all apps?')">Restart All Apps</a></div>
    <table><thead><tr><th>Project</th><th>Status</th><th>CPU / RAM</th><th>Git</th><th>Uptime</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>
    <p><small>Master Uptime: ${Math.floor((Date.now() - startTime) / 1000)}s | Metrics update every 5s</small></p></div></body></html>
  `);
});

server.listen(WEB_PORT, () => process.stdout.write('\n'.repeat(appsConfig.length + 10)));

function restartApp(name) {
  const state = processes.get(name);
  if (state) {
    console.log(`\x1b[36m[Master] Requesting restart for ${name}...\x1b[0m`);
    if (state.child) { state.manualRestart = true; state.child.kill('SIGTERM'); } 
    else { startApp(state.config); }
  }
}
function startApp(config) {
  const existingState = processes.get(config.name) || { restarts: -1, logs: [], git: { branch: '...', dirty: false, sync: '' }, resources: { cpu: '0%', ram: '0MB' } };

  // Search for .env: 1. In project directory, 2. In orchestrator directory as [name].env
  let envFilePath = path.join(config.cwd || process.cwd(), '.env');
  if (!fs.existsSync(envFilePath)) {
    envFilePath = path.join(process.cwd(), `${config.name}.env`);
  }

  const dotEnv = parseEnvFile(envFilePath);

  const newState = { ...existingState, restarts: existingState.restarts + 1, startTime: Date.now(), manualRestart: false, config };
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
    console.log(`\x1b[33m[Master] ${config.name} exited (code: ${code}, signal: ${signal})\x1b[0m`);
    processes.set(config.name, { ...currentState, child: null, resources: { cpu: '0%', ram: '0MB' } });
    if (!isShuttingDown && (currentState.manualRestart || (signal !== 'SIGTERM' && signal !== 'SIGKILL'))) {
      setTimeout(() => startApp(config), currentState.manualRestart ? 500 : 1500);
    }
    renderDashboard();
  });
}

appsConfig.forEach(startApp);
setInterval(renderDashboard, 5000);
setInterval(() => appsConfig.forEach(app => { updateGitInfo(app.name); updateResourceUsage(app.name); }), 5000);

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => { 
  const input = line.trim();
  if (input === 'list') renderDashboard();
  else if (input === 'git') appsConfig.forEach(app => updateGitInfo(app.name));
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
