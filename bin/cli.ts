import readline from 'readline';
import { orchestrator } from '../lib/orchestrator';
import { formatUptime } from '../lib/utils';

const startTime = Date.now();

function renderDashboard() {
  process.stdout.write('\x1b[s\x1b[H');
  process.stdout.write(
    `\x1b[1m\x1b[36m🚀 ORCHESTRATOR CLI \x1b[0m | \x1b[2mmode léger (sans front)\x1b[0m\x1b[K\n`
  );
  process.stdout.write(
    `Uptime: ${formatUptime(Math.floor((Date.now() - startTime) / 1000))}\x1b[K\n\n`
  );

  const head =
    'PROJECT'.padEnd(20) +
    'STATUS'.padEnd(12) +
    'UPTIME'.padEnd(12) +
    'CPU/RAM'.padEnd(18) +
    'GIT'.padEnd(14) +
    'RESTARTS';
  process.stdout.write(`\x1b[1m\x1b[37m${head}\x1b[0m\x1b[K\n`);
  process.stdout.write(`\x1b[90m${'─'.repeat(88)}\x1b[0m\x1b[K\n`);

  for (const app of orchestrator.getStats()) {
    const color = app.status === 'Online' ? '32' : app.shouldRun ? '33' : '31';
    const status = `\x1b[${color}m${app.status.padEnd(12)}\x1b[0m`;
    const uptime = app.uptime.padEnd(12);
    const res = `\x1b[34m${app.cpu}\x1b[0m/\x1b[35m${app.ram}\x1b[0m`.padEnd(27);
    const git = `\x1b[33m${app.git.branch}${app.git.dirty ? '*' : ''}\x1b[0m`.padEnd(23);
    const name = app.name.padEnd(20);
    const restarts = String(app.restarts).padStart(8);
    process.stdout.write(`${name}${status}${uptime}${res}${git}${restarts}\x1b[K\n`);
  }

  process.stdout.write(`\x1b[90m${'─'.repeat(88)}\x1b[0m\x1b[K\n`);
  process.stdout.write(
    '\x1b[2mCommandes: start/stop/restart [name] | list | git\x1b[0m\x1b[K\n\x1b[u'
  );
}

orchestrator.init();
process.stdout.write('\n'.repeat(20));
setInterval(renderDashboard, 2000);

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', line => {
  const input = line.trim();
  const [cmd, name] = input.split(' ');
  if (input === 'list') renderDashboard();
  else if (cmd === 'stop' && name) orchestrator.stop(name);
  else if (cmd === 'start' && name) orchestrator.start(name);
  else if (cmd === 'restart' && name) orchestrator.restart(name);
  else if (input === 'git') renderDashboard();
});

const shutdown = () => {
  console.log('\n\x1b[31m[CLI] Arrêt...\x1b[0m');
  for (const app of orchestrator.getStats()) {
    orchestrator.stop(app.name);
  }
  setTimeout(() => process.exit(0), 1000);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGBREAK', shutdown);
