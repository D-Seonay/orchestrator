// Wrapper lancé par ProcessManager pour chaque service :
//   node watchdog.mjs <orchestratorPid> <commande en base64>
// Lance la vraie commande (shell, stdio hérité, donc les logs passent par les pipes du manager),
// relaie son code de sortie, et tue l'arbre du service si l'Orchestrator disparaît (même tué brutalement).
import { spawn, execFileSync } from 'node:child_process';

const IS_WINDOWS = process.platform === 'win32';
const CHECK_INTERVAL_MS = 1000;

const orchestratorPid = Number(process.argv[2]);
const command = Buffer.from(process.argv[3] || '', 'base64').toString('utf8');

if (!Number.isInteger(orchestratorPid) || orchestratorPid <= 0 || !command) {
  process.stderr.write('watchdog: usage: watchdog.mjs <orchestratorPid> <base64 command>\n');
  process.exit(2);
}

// Le NODE_OPTIONS du service arrive dans ORCH_CHILD_NODE_OPTIONS pour ne pas s'appliquer au watchdog lui-même.
const childEnv = { ...process.env };
delete childEnv.ORCH_CHILD_NODE_OPTIONS;
if (process.env.ORCH_CHILD_NODE_OPTIONS !== undefined) childEnv.NODE_OPTIONS = process.env.ORCH_CHILD_NODE_OPTIONS;

// POSIX : pas de detached, l'enfant reste dans le groupe du watchdog (leader, lancé detached par le manager).
const child = spawn(command, { shell: true, stdio: 'inherit', windowsHide: true, env: childEnv });

let dying = false;
function killChildAndExit(code) {
  if (dying) return;
  dying = true;
  try {
    if (IS_WINDOWS) {
      if (child.pid) execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-process.pid, 'SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
  process.exit(code);
}

function orchestratorAlive() {
  try {
    process.kill(orchestratorPid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

const timer = setInterval(() => {
  if (!orchestratorAlive()) killChildAndExit(1);
}, CHECK_INTERVAL_MS);

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => killChildAndExit(1)); } catch { /* signal non supporté */ }
}

child.once('error', (err) => {
  clearInterval(timer);
  process.stderr.write(`watchdog: ${err.message}\n`);
  process.exit(1);
});

child.once('exit', (code) => {
  clearInterval(timer);
  if (dying) return;
  process.exit(code ?? 1); // tué par un signal ⇒ non nul
});
