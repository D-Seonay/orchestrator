const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4444;
const BASE_URL = `http://localhost:${PORT}`;

async function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}${pathname}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('--- Testing Relative Path Validation ---');
  
  // 1. Create a dummy script in a subfolder
  const testDir = path.join(__dirname, 'test-app');
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir);
  const scriptPath = path.join(testDir, 'app.js');
  fs.writeFileSync(scriptPath, 'console.log("Hello from test app"); setInterval(() => {}, 1000);');

  // Try to create app with relative path (wrong)
  console.log('Testing invalid relative path (relative to orchestrator root)...');
  const res1 = await request('POST', '/api/apps', {
    name: 'relative-test-fail',
    script: 'app.js', // Should fail because app.js is not in root
    cwd: __dirname 
  });
  console.log('Result (expected 400):', res1.status, res1.data);

  // Try to create app with relative path (correct)
  console.log('Testing valid relative path (relative to cwd)...');
  const res2 = await request('POST', '/api/apps', {
    name: 'relative-test-pass',
    script: 'test-app/app.js', // relative to __dirname
    cwd: __dirname
  });
  console.log('Result (expected 201):', res2.status, res2.data);

  console.log('\n--- Testing Rename State Migration ---');
  
  // Wait a bit for logs
  await new Promise(r => setTimeout(r, 2000));
  
  // Check status
  const statusRes = await request('GET', '/api/status');
  const apps = JSON.parse(statusRes.data).apps;
  const testApp = apps.find(a => a.name === 'relative-test-pass');
  console.log('App logs before rename:', testApp.logs.length);
  console.log('App restarts before rename:', testApp.restarts);

  // Rename
  console.log('Renaming app...');
  const renameRes = await request('PATCH', '/api/apps/relative-test-pass', {
    name: 'renamed-app'
  });
  console.log('Rename status (expected 200):', renameRes.status);

  // Wait for it to restart
  await new Promise(r => setTimeout(r, 2000));

  // Check new status
  const statusRes2 = await request('GET', '/api/status');
  const apps2 = JSON.parse(statusRes2.data).apps;
  const renamedApp = apps2.find(a => a.name === 'renamed-app');
  
  if (renamedApp) {
    console.log('App logs after rename:', renamedApp.logs.length);
    console.log('App restarts after rename:', renamedApp.restarts);
    
    if (renamedApp.logs.length > 0 && renamedApp.restarts === testApp.restarts) {
      console.log('SUCCESS: State migrated correctly.');
    } else {
      console.log('FAILURE: State NOT migrated correctly.');
      console.log('Restarts:', renamedApp.restarts, 'Expected:', testApp.restarts);
    }
  } else {
    console.log('FAILURE: Renamed app not found.');
  }

  // Cleanup
  await request('DELETE', '/api/apps/renamed-app');
  await request('DELETE', '/api/apps/relative-test-fail');
  fs.unlinkSync(scriptPath);
  fs.rmdirSync(testDir);
}

test().catch(console.error);
