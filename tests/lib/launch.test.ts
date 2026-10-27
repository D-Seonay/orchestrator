import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectLaunch, listRunConfigs } from '@/lib/launch';

const nodeConfig = (name: string, env: Record<string, string> = {}, temporary = false) => `
    <configuration name="${name}" type="NodeJSConfigurationType"${temporary ? ' temporary="true"' : ''} path-to-js-file="${name}.js" working-dir="$PROJECT_DIR$">
      <envs>${Object.entries(env).map(([k, v]) => `<env name="${k}" value="${v}" />`).join('')}</envs>
    </configuration>`;

const dockerConfig = `
    <configuration name="Dockerfile" type="docker-deploy" factoryName="dockerfile">
      <deployment type="dockerfile" />
    </configuration>`;

function workspace(selected: string | null, configs: string) {
  const sel = selected === null ? '' : ` selected="${selected}"`;
  return `<project version="4"><component name="RunManager"${sel}>${configs}</component></project>`;
}

describe('launch detection', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-launch-'));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  function write(file: string, content: string) {
    const full = path.join(repo, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  function snapshot(dir: string): string[] {
    return fs
      .readdirSync(dir, { withFileTypes: true, recursive: true })
      .map((e) => path.join(e.parentPath, e.name))
      .sort()
      .map((p) => (fs.statSync(p).isFile() ? `${p}:${fs.readFileSync(p, 'utf8')}` : p));
  }

  it('uses the selected IntelliJ config', () => {
    write('.idea/workspace.xml', workspace('Node.js.test', nodeConfig('app') + nodeConfig('test')));
    const { launch } = detectLaunch(repo);
    expect(launch).toMatchObject({ command: 'node test.js', source: 'intellij', configName: 'test' });
  });

  it('configKey overrides the selected config', () => {
    write('.idea/workspace.xml', workspace('Node.js.test', nodeConfig('app.js') + nodeConfig('test')));
    expect(detectLaunch(repo, 'Node.js.app.js').launch).toMatchObject({ source: 'intellij', configName: 'app.js' });
  });

  it('falls back to first non-temporary config when nothing selected', () => {
    write('.idea/workspace.xml', workspace(null, nodeConfig('tmp', {}, true) + nodeConfig('real') + nodeConfig('other')));
    expect(detectLaunch(repo).launch).toMatchObject({ configName: 'real' });
  });

  it('falls back to the first config when all are temporary', () => {
    write('.idea/workspace.xml', workspace(null, nodeConfig('a', {}, true) + nodeConfig('b', {}, true)));
    expect(detectLaunch(repo).launch).toMatchObject({ configName: 'a' });
  });

  it('falls back to npm start when only docker configs exist', () => {
    write('.idea/workspace.xml', workspace('Docker.Dockerfile', dockerConfig));
    write('package.json', JSON.stringify({ scripts: { start: 'node index.js' } }));
    expect(detectLaunch(repo).launch).toEqual({ command: 'npm start', cwd: repo, source: 'package.json' });
  });

  it('falls back to npm start when workspace.xml is malformed', () => {
    write('.idea/workspace.xml', '<project><component name="RunManager"><configuration');
    write('package.json', JSON.stringify({ scripts: { start: 'node index.js' } }));
    expect(detectLaunch(repo).launch).toEqual({ command: 'npm start', cwd: repo, source: 'package.json' });
  });

  it('returns null launch when nothing is runnable', () => {
    write('package.json', JSON.stringify({ scripts: { test: 'vitest' } }));
    expect(detectLaunch(repo)).toEqual({ launch: null, env: {} });
  });

  it('.env values override IntelliJ env', () => {
    write('.idea/workspace.xml', workspace(null, nodeConfig('app', { DB_HOST: 'intellij', ONLY_IDEA: '1' })));
    write('.env', 'DB_HOST=dotenv\nONLY_ENV=2\n');
    expect(detectLaunch(repo).env).toEqual({ DB_HOST: 'dotenv', ONLY_IDEA: '1', ONLY_ENV: '2' });
  });

  it('listRunConfigs returns supported configs, or [] without workspace.xml', () => {
    expect(listRunConfigs(repo)).toEqual([]);
    write('.idea/workspace.xml', workspace(null, nodeConfig('app') + dockerConfig));
    expect(listRunConfigs(repo).map((c) => c.key)).toEqual(['Node.js.app']);
  });

  it('does not write anything in the repo', () => {
    write('.idea/workspace.xml', workspace('Node.js.app', nodeConfig('app', { A: '1' })));
    write('.env', 'B=2');
    write('package.json', '{}');
    const before = snapshot(repo);
    detectLaunch(repo);
    listRunConfigs(repo);
    expect(snapshot(repo)).toEqual(before);
  });
});
