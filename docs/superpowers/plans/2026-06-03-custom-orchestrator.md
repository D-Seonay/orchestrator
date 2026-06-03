# Custom Node.js Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free Node.js orchestrator capable of managing multiple projects with environment isolation, aggregated logging, auto-healing, and interactive manual restarts.

**Architecture:** A master-worker pattern using Node.js `child_process.spawn`. The master script (`orchestrator.js`) reads `apps.config.js`, spawns children with piped stdio, intercepts logs for prefixing, listens for process exit events for auto-healing, and monitors `stdin` for manual restart commands.

**Tech Stack:** Node.js 18+ (Native APIs: `child_process`, `fs`, `path`, `readline`, `events`).

---

### Task 0: Create Test Assets

**Files:**
- Create: `tests/mocks/app1.js`
- Create: `tests/mocks/app2.js`
- Create: `apps.config.js`

- [ ] **Step 1: Create a mock application that logs and stays alive**

```javascript
// tests/mocks/app1.js
console.log('App 1 started');
console.log('PORT:', process.env.PORT);
setInterval(() => console.log('App 1 heartbeat'), 2000);
```

- [ ] **Step 2: Create a mock application that crashes after a few seconds**

```javascript
// tests/mocks/app2.js
console.log('App 2 started');
setTimeout(() => {
  console.error('App 2 simulation crash');
  process.exit(1);
}, 3000);
```

- [ ] **Step 3: Create the initial configuration file**

```javascript
// apps.config.js
module.exports = [
  {
    name: 'app1',
    script: './tests/mocks/app1.js',
    env: { PORT: '3000' }
  },
  {
    name: 'app2',
    script: './tests/mocks/app2.js',
    env: { PORT: '4000' }
  }
];
```

---

### Task 1: Basic Process Spawning and Environment Isolation

**Files:**
- Create: `orchestrator.js`

- [ ] **Step 1: Implement basic config loading and process spawning**

```javascript
// orchestrator.js
const { spawn } = require('child_process');
const path = require('path');
const appsConfig = require('./apps.config.js');

const processes = new Map();

function startApp(config) {
  console.log(`[Master] Starting ${config.name}...`);
  const child = spawn('node', [config.script], {
    env: { ...process.env, ...config.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  processes.set(config.name, { child, config });

  child.stdout.on('data', (data) => {
    process.stdout.write(`[${config.name}] ${data}`);
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(`[${config.name} ERROR] ${data}`);
  });
}

appsConfig.forEach(startApp);
```

- [ ] **Step 2: Run the orchestrator and verify logs/isolation**

Run: `node orchestrator.js`
Expected: See logs from both `app1` and `app2` with correct prefixes and ports.

---

### Task 2: Log Aggregation and Formatting

**Files:**
- Modify: `orchestrator.js`

- [ ] **Step 1: Enhance the logger to handle multi-line output correctly**

```javascript
// orchestrator.js updates
function formatLog(name, data, isError = false) {
  const lines = data.toString().trim().split('\n');
  const prefix = isError ? `\x1b[31m[${name}]\x1b[0m` : `\x1b[32m[${name}]\x1b[0m`;
  return lines.map(line => `${prefix} ${line}`).join('\n') + '\n';
}

// Update startApp event handlers:
child.stdout.on('data', (data) => {
  process.stdout.write(formatLog(config.name, data));
});

child.stderr.on('data', (data) => {
  process.stderr.write(formatLog(config.name, data, true));
});
```

---

### Task 3: Auto-healing (Restart on Crash)

**Files:**
- Modify: `orchestrator.js`

- [ ] **Step 1: Implement exit listener and delayed restart**

```javascript
// orchestrator.js updates
function startApp(config) {
  // ... existing spawn logic ...
  
  child.on('exit', (code, signal) => {
    console.log(`[Master] ${config.name} exited with code ${code} (signal: ${signal})`);
    processes.delete(config.name);
    
    if (signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      console.log(`[Master] Restarting ${config.name} in 1.5s...`);
      setTimeout(() => startApp(config), 1500);
    }
  });
}
```

- [ ] **Step 2: Verify auto-healing with app2**

Run: `node orchestrator.js`
Expected: `app2` crashes after 3s and restarts automatically 1.5s later.

---

### Task 4: Interactive Manual Restart

**Files:**
- Modify: `orchestrator.js`

- [ ] **Step 1: Implement stdin listener for command processing**

```javascript
// orchestrator.js updates
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const name = line.trim();
  if (processes.has(name)) {
    console.log(`[Master] Manually restarting ${name}...`);
    const { child, config } = processes.get(name);
    child.kill('SIGTERM'); // This will trigger the 'exit' event and then Task 3 logic
  } else if (name === 'list') {
    console.log('[Master] Running apps:', Array.from(processes.keys()).join(', '));
  }
});
```

- [ ] **Step 2: Test manual restart**

Run: `node orchestrator.js`, then type `app1` and press Enter.
Expected: `app1` is killed and restarts.

---

### Task 5: Graceful Shutdown

**Files:**
- Modify: `orchestrator.js`

- [ ] **Step 1: Implement SIGINT handling to kill all children**

```javascript
// orchestrator.js updates
process.on('SIGINT', () => {
  console.log('\n[Master] Stopping all processes...');
  for (const [name, { child }] of processes) {
    console.log(`[Master] Killing ${name}...`);
    child.kill('SIGKILL');
  }
  process.exit(0);
});
```

- [ ] **Step 2: Verify cleanup**

Run: `node orchestrator.js`, wait for start, then press `Ctrl+C`.
Expected: Master logs "Stopping all processes" and exits cleanly.
