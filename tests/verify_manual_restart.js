const http = require('http');

async function test() {
  console.log('--- Testing Project Management API ---');

  const postData = JSON.stringify({
    name: 'test-app',
    script: 'tests/test-app/app.js',
    cwd: process.cwd()
  });

  // 1. Create App
  console.log('1. Creating app...');
  await request('/api/apps', 'POST', postData);

  // Wait for it to start and produce some logs
  await new Promise(r => setTimeout(r, 2000));

  // 2. Check Status & Logs
  console.log('2. Checking status...');
  let status = await request('/api/status', 'GET');
  let app = status.apps.find(a => a.name === 'test-app');
  console.log(`   App: ${app.name}, Status: ${app.status}, Logs: ${app.logs.length}`);
  if (app.logs.length === 0) throw new Error('No logs found');

  // 3. Rename App
  console.log('3. Renaming app...');
  await request('/api/apps/test-app', 'PATCH', JSON.stringify({ name: 'test-app-v2' }));

  // Wait for restart
  await new Promise(r => setTimeout(r, 2000));

  // 4. Check Status & Logs again
  console.log('4. Checking status after rename...');
  status = await request('/api/status', 'GET');
  app = status.apps.find(a => a.name === 'test-app-v2');
  const oldApp = status.apps.find(a => a.name === 'test-app');

  if (oldApp) throw new Error('Old app name still exists in status!');
  if (!app) throw new Error('New app name not found!');
  
  console.log(`   App: ${app.name}, Status: ${app.status}, Logs: ${app.logs.length}`);
  if (app.logs.length === 0) throw new Error('Logs lost after rename!');

  console.log('--- Test Passed! ---');
}

function request(path, method, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 4444,
      path,
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        else {
          try {
            resolve(body ? JSON.parse(body) : null);
          } catch (e) {
            resolve(body);
          }
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test().catch(err => {
  console.error('Test Failed:', err.message);
  process.exit(1);
});
