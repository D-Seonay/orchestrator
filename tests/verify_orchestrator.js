const { spawn } = require('child_process');

console.log('Running orchestrator verification...');

const orchestrator = spawn('node', ['orchestrator.js'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
orchestrator.stdout.on('data', (data) => {
  const str = data.toString();
  output += str;
  process.stdout.write(str);
});

orchestrator.stderr.on('data', (data) => {
  const str = data.toString();
  output += str;
  process.stderr.write(str);
});

setTimeout(() => {
  console.log('\nStopping orchestrator...');
  orchestrator.kill();
  
  const expectedLogs = [
    '[Master] Starting app1...',
    '[Master] Starting app2...',
    '\x1b[32m[app1]\x1b[0m App 1 started',
    '\x1b[32m[app1]\x1b[0m PORT: 3000',
    '\x1b[32m[app2]\x1b[0m App 2 started',
    '\x1b[31m[app2]\x1b[0m App 2 simulation crash'
  ];

  let allPassed = true;
  expectedLogs.forEach(log => {
    if (output.includes(log)) {
      console.log(`PASS: Found "${log}"`);
    } else {
      console.error(`FAIL: Missing "${log}"`);
      allPassed = false;
    }
  });

  if (allPassed) {
    console.log('\nVerification SUCCESSFUL');
    process.exit(0);
  } else {
    console.error('\nVerification FAILED');
    process.exit(1);
  }
}, 5000);
