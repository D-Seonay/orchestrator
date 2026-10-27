// Stand-in Orchestrator for the hard-kill test: runs a real ProcessManager in its own process
// (default orchestratorPid = this pid), starts one service and prints the pids to watch.
// Usage: node --import tsx tests/helpers/pm-host.ts <pidFile> <command>
import { ProcessManager } from '../../lib/process-manager';

const [pidFile, command] = process.argv.slice(2);
const pm = new ProcessManager({ pidFile, backoffMs: () => 60_000 });
pm.start('svc', { command, cwd: process.cwd(), source: 'manual' }, {});

const timer = setInterval(() => {
  const line = pm.logs('svc', 0).find((l) => l.stream === 'out' && /^\d+$/.test(l.text));
  if (!line) return;
  clearInterval(timer);
  console.log(`PIDS ${pm.status('svc').pid} ${line.text}`);
}, 25);
