# Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `bin/setup.ts` utility that automates the initialization of all projects defined in `apps.config.json`.

**Architecture:** A standalone TypeScript script using `tsx`. It iterates through `apps.config.json`, performs sequential checks (Clone -> Install -> Env -> Build), and provides terminal feedback.

**Tech Stack:** TypeScript, `tsx`, Node.js `child_process` (spawn/exec), `readline`.

---

### Task 1: Update Types & Config

**Files:**
- Modify: `types/index.ts`
- Modify: `apps.config.json`

- [ ] **Step 1: Add new properties to `AppConfig` type**

```typescript
// types/index.ts
export interface AppConfig {
  name: string;
  script: string;
  args?: string | string[];
  cwd?: string;
  env?: Record<string, string>;
  group?: string;
  type?: 'node' | 'docker';
  ports?: string[];
  autoStart?: boolean;
  dockerfile?: string;
  // New properties
  repository?: string;
  installCommand?: string;
  buildCommand?: string;
}
```

- [ ] **Step 2: Update `apps.config.json` with sample data**

Add a `repository` field to at least one entry for testing.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts apps.config.json
git commit -m "chore: add setup-related fields to AppConfig"
```

---

### Task 2: Implement Setup Wizard Core (`bin/setup.ts`)

**Files:**
- Create: `bin/setup.ts`

- [ ] **Step 1: Write the basic script structure and imports**

```typescript
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AppConfig } from '../types';

const CONFIG_PATH = path.join(process.cwd(), 'apps.config.json');

function log(app: string, step: string, msg: string, type: 'info' | 'success' | 'error' = 'info') {
  const colors = { info: '\x1b[36m', success: '\x1b[32m', error: '\x1b[31m', reset: '\x1b[0m' };
  console.log(`${colors[type]}[${app}] ${step.toUpperCase()}: ${msg}${colors.reset}`);
}

async function runCommand(cmd: string, args: string[], cwd: string, appName: string, step: string): Promise<boolean> {
  return new Promise((resolve) => {
    log(appName, step, `Running ${cmd} ${args.join(' ')}...`);
    const child = spawn(cmd, args, { cwd, shell: true, stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) {
        log(appName, step, 'Success!', 'success');
        resolve(true);
      } else {
        log(appName, step, `Failed with code ${code}`, 'error');
        resolve(false);
      }
    });
  });
}
```

- [ ] **Step 2: Implement the main loop and logic phases**

```typescript
async function setup() {
  const configs: AppConfig[] = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const results: any[] = [];

  for (const app of configs) {
    const cwd = app.cwd || process.cwd();
    const appResults = { name: app.name, clone: '-', install: '-', env: '-', build: '-' };
    
    // 1. Clone
    if (!fs.existsSync(cwd)) {
      if (app.repository) {
        const parentDir = path.dirname(cwd);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        const success = await runCommand('git', ['clone', app.repository, path.basename(cwd)], parentDir, app.name, 'clone');
        appResults.clone = success ? 'OK' : 'FAIL';
        if (!success) { results.push(appResults); continue; }
      } else {
        log(app.name, 'clone', 'Skipped (no repo/dir)', 'info');
      }
    }

    // 2. Install
    if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
      const cmd = app.installCommand || 'npm install';
      const [c, ...a] = cmd.split(' ');
      const success = await runCommand(c, a, cwd, app.name, 'install');
      appResults.install = success ? 'OK' : 'FAIL';
    }

    // 3. Env
    const envPath = path.join(cwd, '.env');
    if (!fs.existsSync(envPath)) {
      const examplePath = fs.existsSync(path.join(cwd, '.env.example')) ? '.env.example' : '.env.template';
      if (fs.existsSync(path.join(cwd, examplePath))) {
        fs.copyFileSync(path.join(cwd, examplePath), envPath);
        log(app.name, 'env', `Created .env from ${examplePath}`, 'success');
        appResults.env = 'OK';
      } else {
        fs.writeFileSync(envPath, '');
        log(app.name, 'env', 'Created empty .env', 'info');
        appResults.env = 'NEW';
      }
    }

    // 4. Build
    const buildCmd = app.buildCommand || 'npm run build';
    const [bc, ...ba] = buildCmd.split(' ');
    const bSuccess = await runCommand(bc, ba, cwd, app.name, 'build');
    appResults.build = bSuccess ? 'OK' : 'FAIL';

    results.push(appResults);
  }

  console.table(results);
}

setup();
```

- [ ] **Step 3: Test the script with a dry run**

Run: `npm run setup`
Check: Observe the logs and verify that it correctly identifies missing directories or node_modules.

- [ ] **Step 4: Commit**

```bash
git add bin/setup.ts
git commit -m "feat: implement setup wizard core logic"
```

---

### Task 3: Verification & Final Polish

- [ ] **Step 1: Verify on a managed app**

Choose one app (e.g., `Supplies-Semaphore`), delete its `node_modules`, and run `npm run setup`.
Verify: `node_modules` is recreated and build is triggered.

- [ ] **Step 2: Add help message or usage info to `bin/setup.ts`**

- [ ] **Step 3: Final Commit**

```bash
git commit -am "docs: finalize setup wizard implementation"
```
