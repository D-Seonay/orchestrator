const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

async function checkUrl(url, expectedStatus, expectedContent) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const statusMatch = res.statusCode === expectedStatus;
        const contentMatch = expectedContent ? data.includes(expectedContent) : true;
        if (statusMatch && contentMatch) {
          resolve({ pass: true });
        } else {
          resolve({ 
            pass: false, 
            status: res.statusCode, 
            expectedStatus, 
            contentMatch, 
            data: data.substring(0, 100) 
          });
        }
      });
    }).on('error', reject);
  });
}

async function runTest() {
  console.log('Starting orchestrator for integration test...');
  const orchestrator = spawn('node', ['orchestrator.js'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  orchestrator.stdout.on('data', (data) => console.log(`[Orchestrator STDOUT] ${data}`));
  orchestrator.stderr.on('data', (data) => console.error(`[Orchestrator STDERR] ${data}`));
  await new Promise(r => setTimeout(r, 2000));

  const results = [];

  try {
    // 1. Check if index.html is served at root
    console.log('Checking root (index.html)...');
    results.push({ name: 'Root index.html', ...(await checkUrl('http://localhost:4444/', 200, '<div id="root"></div>')) });

    // 2. Check if a non-existent file falls back to index.html (SPA routing)
    console.log('Checking SPA fallback...');
    results.push({ name: 'SPA Fallback', ...(await checkUrl('http://localhost:4444/some-random-route', 200, '<div id="root"></div>')) });

    // 3. Check if an asset is served correctly
    // We need to find an actual asset filename
    const assetsDir = path.join(__dirname, '..', 'dashboard', 'dist', 'assets');
    const assetFiles = fs.readdirSync(assetsDir);
    const jsFile = assetFiles.find(f => f.endsWith('.js'));
    if (jsFile) {
      console.log(`Checking asset: ${jsFile}...`);
      results.push({ name: 'Asset Serving', ...(await checkUrl(`http://localhost:4444/assets/${jsFile}`, 200)) });
    } else {
      results.push({ name: 'Asset Serving', pass: false, error: 'No JS asset found in dist' });
    }

    // 4. Check API status
    console.log('Checking API status...');
    results.push({ name: 'API Status', ...(await checkUrl('http://localhost:4444/api/status', 200, '"apps":')) });

    // 5. Check non-existent API returns 404
    console.log('Checking invalid API...');
    results.push({ name: 'Invalid API 404', ...(await checkUrl('http://localhost:4444/api/invalid-endpoint', 404)) });

  } catch (err) {
    console.error('Test failed with error:', err);
  } finally {
    console.log('Stopping orchestrator...');
    orchestrator.kill();
  }

  console.log('\n--- Test Results ---');
  let allPassed = true;
  results.forEach(r => {
    if (r.pass) {
      console.log(`PASS: ${r.name}`);
    } else {
      console.error(`FAIL: ${r.name}`, r);
      allPassed = false;
    }
  });

  if (allPassed) {
    console.log('\nINTEGRATION SUCCESSFUL');
    process.exit(0);
  } else {
    console.error('\nINTEGRATION FAILED');
    process.exit(1);
  }
}

runTest();
