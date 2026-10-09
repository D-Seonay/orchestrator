import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { orchestrator } from '@/lib/orchestrator';

describe('Orchestrator Management', () => {
  const configPath = path.join(process.cwd(), 'apps.config.json');
  let originalConfig = '';

  beforeAll(() => {
    if (fs.existsSync(configPath)) {
      originalConfig = fs.readFileSync(configPath, 'utf8');
    }
  });

  afterAll(() => {
    if (originalConfig) {
      fs.writeFileSync(configPath, originalConfig, 'utf8');
    }
  });

  const testApp = {
    name: 'test-service-suite',
    script: 'test.js',
    cwd: process.cwd(),
    group: 'test-group',
    autoStart: false,
  };

  beforeEach(() => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
    orchestrator.remove(testApp.name);
  });

  afterEach(() => {
    orchestrator.remove(testApp.name);
    vi.restoreAllMocks();
  });

  it('adds an application to the config', () => {
    orchestrator.add(testApp);
    const configs = orchestrator.getAppsConfig();
    const found = configs.find(a => a.name === testApp.name);
    expect(found).toBeDefined();
    expect(found?.name).toBe('test-service-suite');
    expect(found?.group).toBe('test-group');
  });

  it('updates an application config', () => {
    orchestrator.add(testApp);
    orchestrator.update(testApp.name, { group: 'updated-group' });
    const configs = orchestrator.getAppsConfig();
    const found = configs.find(a => a.name === testApp.name);
    expect(found?.group).toBe('updated-group');
  });

  it('removes an application from config and processes', () => {
    orchestrator.add(testApp);
    expect(orchestrator.getAppsConfig().some(a => a.name === testApp.name)).toBe(true);

    orchestrator.remove(testApp.name);
    expect(orchestrator.getAppsConfig().some(a => a.name === testApp.name)).toBe(false);
  });

  it('returns valid app stats and master uptime', () => {
    orchestrator.add(testApp);
    const stats = orchestrator.getStats();
    const appStats = stats.find(s => s.name === testApp.name);

    expect(appStats).toBeDefined();
    expect(['Online', 'Stopped', 'Restarting', 'Building']).toContain(appStats?.status);
    expect(appStats?.cpu).toBeDefined();
    expect(appStats?.ram).toBeDefined();

    const uptime = orchestrator.getMasterUptime();
    expect(typeof uptime).toBe('string');
    expect(uptime.length).toBeGreaterThan(0);
  });

  it('handles group operations without errors', () => {
    orchestrator.add(testApp);
    expect(() => {
      orchestrator.stopGroup('test-group');
      orchestrator.restartGroup('test-group');
    }).not.toThrow();
  });
});
