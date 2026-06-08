const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const http = require('http');
const url = require('url');

const configPath = path.join(__dirname, 'apps.config.json');
const appsConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

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
  const head = 'PROJECT'.padEnd(20) + 'STATUS'.padEnd(12) + 'CPU/RAM'.padEnd(18) + 'GIT'.padEnd(15) + 'RESTARTS';
  process.stdout.write('\x1b[1m\x1b[37m' + head + '\x1b[0m\x1b[K\n');
  process.stdout.write('\x1b[90m' + '─'.repeat(75) + '\x1b[0m\x1b[K\n');
  for (const app of appsConfig) {
    const s = getAppStats(app.name);
    if (!s) continue;
    const color = s.status === 'Online' ? '32' : (s.shouldRun ? '33' : '31');
    const status = `\x1b[${color}m${s.status.padEnd(12)}\x1b[0m`;
    const res = `\x1b[34m${s.cpu}\x1b[0m / \x1b[35m${s.ram}\x1b[0m`.padEnd(30);
    const git = `\x1b[33m${s.git.branch}${s.git.dirty ? '*' : ''}\x1b[0m`.padEnd(25);
    process.stdout.write(s.name.padEnd(20) + status + res + git + s.restarts + '\x1b[K\n');
  }
  process.stdout.write('\x1b[90m' + '─'.repeat(75) + '\x1b[0m\x1b[K\n');
  process.stdout.write('\x1b[2mCommands: start/stop/restart [name] | git | list\x1b[0m\x1b[K\n\x1b[u'); 
}

// --- Serveur Web Dashboard ---
const server = http.createServer((req, res) => {
  const reqUrl = url.parse(req.url, true);
  const pathname = reqUrl.pathname;

  // API Endpoints
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

  // HTML UI
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Orchestrator Pro</title>
      <style>
        :root { --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --primary: #3b82f6; --success: #10b981; --danger: #ef4444; --warning: #f59e0b; }
        body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; line-height: 1.5; }
        .container { max-width: 1100px; margin: 0 auto; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; background: var(--card); padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        h1 { margin: 0; font-size: 1.5rem; display: flex; align-items: center; gap: 10px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px; }
        .card { background: var(--card); border-radius: 12px; padding: 20px; transition: transform 0.2s; border: 1px solid rgba(255,255,255,0.05); }
        .card:hover { transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.2); }
        .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; }
        .app-name { font-weight: 700; font-size: 1.1rem; }
        .status-badge { padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
        .status-Online { background: rgba(16,185,129,0.1); color: var(--success); border: 1px solid var(--success); }
        .status-Stopped { background: rgba(239,68,68,0.1); color: var(--danger); border: 1px solid var(--danger); }
        .status-Restarting { background: rgba(245,158,11,0.1); color: var(--warning); border: 1px solid var(--warning); }
        .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
        .metric { background: rgba(0,0,0,0.2); padding: 8px; border-radius: 8px; text-align: center; }
        .metric-label { font-size: 0.7rem; color: #94a3b8; display: block; }
        .metric-value { font-weight: 600; font-size: 0.9rem; }
        .git-info { font-size: 0.8rem; background: rgba(59,130,246,0.1); padding: 8px; border-radius: 8px; margin-bottom: 15px; color: #93c5fd; }
        .actions { display: flex; gap: 8px; }
        button, .btn { cursor: pointer; border: none; padding: 8px 12px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; color: white; display: flex; align-items: center; gap: 5px; transition: opacity 0.2s; text-decoration: none; }
        button:hover { opacity: 0.8; }
        .btn-start { background: var(--success); }
        .btn-stop { background: var(--danger); }
        .btn-restart { background: var(--primary); }
        .btn-logs { background: #64748b; }
        .btn-all { background: var(--warning); padding: 10px 20px; font-size: 0.9rem; }
        #logs-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 100; padding: 40px; }
        .modal-content { background: #1e1e1e; height: 100%; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; }
        .modal-header { padding: 15px 20px; background: #252526; display: flex; justify-content: space-between; border-bottom: 1px solid #333; }
        #logs-body { flex: 1; padding: 20px; overflow-y: auto; font-family: 'Fira Code', monospace; font-size: 0.85rem; color: #d4d4d4; white-space: pre-wrap; }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>🚀 Orchestrator Live <span id="master-uptime" style="font-size: 0.9rem; font-weight: 400; opacity: 0.7;"></span></h1>
          <button class="btn-all" onclick="doAction('', 'restart-all')">🔄 Restart All Apps</button>
        </header>
        <div id="app-grid" class="grid"></div>
      </div>

      <div id="logs-modal" onclick="closeLogs()">
        <div class="modal-content" onclick="event.stopPropagation()">
          <div class="modal-header">
            <span id="modal-title" style="font-weight: bold;">Logs</span>
            <button onclick="closeLogs()" style="background: transparent; font-size: 1.2rem;">&times;</button>
          </div>
          <div id="logs-body"></div>
        </div>
      </div>

      <script>
        let currentLogsApp = null;
        async function update() {
          const res = await fetch('/api/status');
          const data = await res.json();
          document.getElementById('master-uptime').innerText = '| Uptime: ' + data.masterUptime;
          
          const grid = document.getElementById('app-grid');
          grid.innerHTML = data.apps.map(app => \`
            <div class="card">
              <div class="card-header">
                <div class="app-name">\${app.name}</div>
                <span class="status-badge status-\${app.status}">\${app.status}</span>
              </div>
              <div class="metrics">
                <div class="metric"><span class="metric-label">CPU</span><span class="metric-value">\${app.cpu}</span></div>
                <div class="metric"><span class="metric-label">RAM</span><span class="metric-value">\${app.ram}</span></div>
                <div class="metric"><span class="metric-label">RESTARTS</span><span class="metric-value">\${app.restarts}</span></div>
                <div class="metric"><span class="metric-label">UPTIME</span><span class="metric-value">\${app.uptime}</span></div>
              </div>
              <div class="git-info">
                🌳 <b>\${app.git.branch}\${app.git.dirty ? '*' : ''}</b> \${app.git.sync}
              </div>
              <div class="actions">
                \${app.status === 'Online' 
                  ? \`<button class="btn-stop" onclick="doAction('\${app.name}', 'stop')">⏹ Stop</button>\`
                  : \`<button class="btn-start" onclick="doAction('\${app.name}', 'start')">▶ Start</button>\`
                }
                <button class="btn-restart" onclick="doAction('\${app.name}', 'restart')">🔄 Restart</button>
                <button class="btn-logs" onclick="showLogs('\${app.name}')">📄 Logs</button>
              </div>
            </div>
          \`).join('');

          if (currentLogsApp) {
            const app = data.apps.find(a => a.name === currentLogsApp);
            if (app) {
              const body = document.getElementById('logs-body');
              const shouldScroll = body.scrollTop + body.clientHeight >= body.scrollHeight - 20;
              body.innerText = app.logs.join('\\n');
              if (shouldScroll) body.scrollTop = body.scrollHeight;
            }
          }
        }

        async function doAction(app, action) {
          if (action === 'restart-all' && !confirm('Restart all projects?')) return;
          await fetch(\`/api/action?app=\${app}&action=\${action}\`);
          update();
        }

        function showLogs(name) {
          currentLogsApp = name;
          document.getElementById('modal-title').innerText = 'Logs: ' + name;
          document.getElementById('logs-modal').style.display = 'block';
          update();
        }

        function closeLogs() {
          currentLogsApp = null;
          document.getElementById('logs-modal').style.display = 'none';
        }

        setInterval(update, 2000);
        update();
      </script>
    </body>
    </html>
  `);
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
    processes.set(config.name, { ...currentState, child: null, resources: { cpu: '0%', ram: '0MB' } });
    if (!isShuttingDown && currentState.shouldRun && (currentState.manualRestart || (signal !== 'SIGTERM' && signal !== 'SIGKILL'))) {
      setTimeout(() => startApp(config), currentState.manualRestart ? 500 : 1500);
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
