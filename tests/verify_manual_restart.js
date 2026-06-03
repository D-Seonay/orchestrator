const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const orchestratorPath = path.join(__dirname, '..', 'orchestrator.js');
const orchestrator = spawn('node', [orchestratorPath], {
  cwd: path.join(__dirname, '..'),
  stdio: ['pipe', 'pipe', 'pipe']
});

const rl = readline.createInterface({
  input: orchestrator.stdout,
  terminal: false
});

const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');

let state = 'WAITING_FOR_START';
let timeout = setTimeout(() => {
  console.error('Test timed out in state:', state);
  orchestrator.kill();
  process.exit(1);
}, 10000);

rl.on('line', (line) => {
  const cleanLine = stripAnsi(line);
  console.log('OUTPUT:', cleanLine);

  if (state === 'WAITING_FOR_START' && cleanLine.includes('[app1] App 1 started')) {
    console.log('Detected app1 started. Sending restart command...');
    state = 'WAITING_FOR_RESTART_MSG';
    orchestrator.stdin.write('app1\n');
  } else if (state === 'WAITING_FOR_RESTART_MSG' && cleanLine.includes('[Master] Manually restarting app1...')) {
    console.log('Detected manual restart message.');
    state = 'WAITING_FOR_EXIT';
  } else if (state === 'WAITING_FOR_EXIT' && cleanLine.includes('[Master] app1 exited')) {
    console.log('Detected app1 exit.');
    state = 'WAITING_FOR_RESTART_START';
  } else if (state === 'WAITING_FOR_RESTART_START' && cleanLine.includes('[Master] Starting app1...')) {
    console.log('Detected app1 starting again.');
    state = 'WAITING_FOR_SECOND_START';
  } else if (state === 'WAITING_FOR_SECOND_START' && cleanLine.includes('[app1] App 1 started')) {
    console.log('Detected app1 started again. SUCCESS!');
    clearTimeout(timeout);
    orchestrator.kill();
    process.exit(0);
  }
});

orchestrator.stderr.on('data', (data) => {
  console.error('STDERR:', stripAnsi(data.toString()));
});

orchestrator.on('exit', (code) => {
  if (state !== 'WAITING_FOR_SECOND_START' || code !== 0) {
    // If it exited but we weren't done, it's a failure unless we just killed it
    if (state !== 'FINISHED') {
        console.error('Orchestrator exited unexpectedly with code:', code);
        process.exit(1);
    }
  }
});

// Helper to track if we finished
rl.on('close', () => {
    state = 'FINISHED';
});
