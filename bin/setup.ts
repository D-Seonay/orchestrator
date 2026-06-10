import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AppConfig } from '../types';

const CONFIG_PATH = path.join(process.cwd(), 'apps.config.json');

function log(app: string, step: string, msg: string, type: 'info' | 'success' | 'error' = 'info') {
  const colors = { 
    info: '\x1b[36m', 
    success: '\x1b[32m', 
    error: '\x1b[31m', 
    reset: '\x1b[0m' 
  };
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
    child.on('error', (err) => {
      log(appName, step, `Error: ${err.message}`, 'error');
      resolve(false);
    });
  });
}

async function setup() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Config file not found at ${CONFIG_PATH}`);
    process.exit(1);
  }

  const configs: AppConfig[] = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const results: any[] = [];

  console.log('\x1b[35m%s\x1b[0m', '=== Starting Setup Wizard ===\n');

  for (const app of configs) {
    const cwd = app.cwd || process.cwd();
    const appResults = { 
      name: app.name, 
      clone: '-', 
      install: '-', 
      env: '-', 
      build: '-' 
    };
    
    // 1. Clone
    if (!fs.existsSync(cwd)) {
      if (app.repository) {
        const parentDir = path.dirname(cwd);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        const success = await runCommand('git', ['clone', app.repository, path.basename(cwd)], parentDir, app.name, 'clone');
        appResults.clone = success ? 'OK' : 'FAIL';
        if (!success) { 
          results.push(appResults); 
          continue; 
        }
      } else {
        log(app.name, 'clone', 'Skipped (no repo/dir)', 'info');
      }
    } else {
      appResults.clone = 'EXISTS';
    }

    // 2. Install
    if (!fs.existsSync(path.join(cwd, 'node_modules'))) {
      const cmd = app.installCommand || 'npm install';
      const [c, ...a] = cmd.split(' ');
      const success = await runCommand(c, a, cwd, app.name, 'install');
      appResults.install = success ? 'OK' : 'FAIL';
    } else {
      appResults.install = 'OK';
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
    } else {
      appResults.env = 'OK';
    }

    // 4. Build
    const buildCmd = app.buildCommand || 'npm run build';
    const [bc, ...ba] = buildCmd.split(' ');
    const bSuccess = await runCommand(bc, ba, cwd, app.name, 'build');
    appResults.build = bSuccess ? 'OK' : 'FAIL';

    results.push(appResults);
    console.log(''); // New line between apps
  }

  console.log('\x1b[35m%s\x1b[0m', '\n=== Setup Summary ===');
  console.table(results);
}

setup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
