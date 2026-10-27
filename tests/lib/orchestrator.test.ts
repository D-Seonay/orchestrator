import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createOrchestrator, projectKey } from '@/lib/orchestrator';
import { ProcessManager } from '@/lib/process-manager';
import type { StoredState } from '@/lib/types';
import { cloneRepo, commitFile, createRepoPair, git, push, writeFile, type RepoPair } from '../helpers/repos';

const T = 60_000;
const LONG = `node -e "setInterval(() => {}, 1000)"`;

async function waitFor(cond: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const rmRetry = (dir: string) => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });

describe('orchestrator', () => {
  let pair: RepoPair;
  let root: string;
  let dataDir: string;
  let saved: StoredState;
  let pm: ProcessManager;
  let orch: ReturnType<typeof createOrchestrator>;

  /** Clone d'origin dans la racine, avec un package.json non versionné. */
  function addService(name: string, version = '1.2.3') {
    const dir = cloneRepo(pair.origin, path.join(root, name));
    writeFile(dir, 'package.json', JSON.stringify({ name, version }));
    return dir;
  }

  function addDatabase(name: string, version: string) {
    const dir = cloneRepo(pair.origin, path.join(root, name));
    writeFile(dir, 'version.md', `${version}\n`);
    return dir;
  }

  const view = (name: string) => orch.dashboard().projects.find((p) => p.name === name);

  beforeEach(() => {
    pair = createRepoPair();
    root = path.join(pair.base, 'root');
    dataDir = path.join(pair.base, 'data');
    fs.mkdirSync(root);
    saved = { root, projects: {}, groups: {} };
    pm = new ProcessManager({ pidFile: path.join(dataDir, 'pids.json'), backoffMs: () => 50 });
    orch = createOrchestrator({
      store: { load: () => structuredClone(saved), save: (s) => { saved = structuredClone(s); } },
      pm,
    });
  }, T);

  afterEach(async () => {
    pm.killAll();
    // Un getGitInfo lancé par refresh() peut encore tenir le dossier : on réessaie la suppression.
    await rmRetry(pair.base);
  });

  it('refresh imports launch and env for new services only once', () => {
    const dir = addService('svc-a');
    writeFile(dir, '.env', 'A=1\n');

    orch.refresh();
    const first = orch.getSettings('svc-a')!;
    expect(first.env).toEqual({ A: '1' });
    expect(first.launch).toBeNull();
    expect(new Date(first.importedAt).toISOString()).toBe(first.importedAt);
    expect(saved.projects[projectKey(dir)]).toEqual(first);

    writeFile(dir, '.env', 'A=2\n');
    orch.refresh();
    expect(orch.getSettings('svc-a')!.env).toEqual({ A: '1' });

    expect(orch.reimport('svc-a').env).toEqual({ A: '2' });
    expect(orch.getSettings('svc-a')!.env).toEqual({ A: '2' });
    expect(saved.projects[projectKey(dir)].env).toEqual({ A: '2' });
  });

  it('new folder cloned later appears on next refresh', () => {
    addService('svc-a');
    orch.refresh();
    expect(orch.dashboard().projects.map((p) => p.name)).toEqual(['svc-a']);

    addService('svc-b');
    orch.refresh();
    expect(orch.dashboard().projects.map((p) => p.name)).toEqual(['svc-a', 'svc-b']);
    expect(orch.getSettings('svc-b')).not.toBeNull();
  });

  it('removed folder disappears but its settings are kept', async () => {
    addService('svc-a');
    const b = addService('svc-b');
    orch.refresh();

    await rmRetry(b);
    orch.refresh();

    expect(orch.dashboard().projects.map((p) => p.name)).toEqual(['svc-a']);
    expect(saved.projects[projectKey(b)]).toBeDefined();

    // Le dossier revient (re-clone) : ses réglages sont repris, pas réimportés.
    addService('svc-b');
    orch.refresh();
    expect(orch.getSettings('svc-b')).toEqual(saved.projects[projectKey(b)]);
  });

  it('keeps a removed folder visible as missing while it still runs', async () => {
    addService('svc-a');
    orch.refresh();
    orch.updateSettings('svc-a', { command: LONG });
    await orch.act(['svc-a'], 'start');

    // Le dossier disparaît du scan (racine changée) alors que le service tourne.
    fs.mkdirSync(path.join(pair.base, 'elsewhere'));
    orch.setRoot(path.join(pair.base, 'elsewhere'));

    const v = view('svc-a')!;
    expect(v.missing).toBe(true);
    expect(v.status).toBe('running');
    await orch.act(['svc-a'], 'stop');
    expect(view('svc-a')).toBeUndefined();
  }, T);

  it('dashboard reports dbVersion from the database repo', async () => {
    addService('svc-a');
    addDatabase('db', '5.9.1');
    orch.refresh();

    const dash = orch.dashboard();
    expect(dash.dbVersion).toBe('5.9.1');
    expect(dash.root).toBe(root);
    expect(dash.rootExists).toBe(true);
    const db = dash.projects.find((p) => p.name === 'db')!;
    expect(db.kind).toBe('database');
    expect(db.launch).toBeNull();

    await waitFor(() => view('db')?.git != null);
    expect(view('db')!.git!.branch).toBe('main');
  }, T);

  it('act start ignores database repos', async () => {
    addDatabase('db', '5.9.1');
    orch.refresh();

    await orch.act(['db', 'ghost'], 'start');

    expect(pm.status('db').status).toBe('stopped');
    expect(pm.logs('db', 0)).toEqual([]);
  });

  it('act start does nothing for a service without launch command', async () => {
    addService('svc-a');
    orch.refresh();

    await orch.act(['svc-a'], 'start');

    expect(pm.status('svc-a').status).toBe('stopped');
  });

  it('updateSettings command sets source manual', () => {
    const dir = addService('svc-a');
    writeFile(dir, '.env', 'A=1\n');
    orch.refresh();

    orch.updateSettings('svc-a', { command: 'node server.js' });
    expect(orch.getSettings('svc-a')!.launch).toEqual({ command: 'node server.js', cwd: dir, source: 'manual' });
    expect(orch.getSettings('svc-a')!.env).toEqual({ A: '1' });

    orch.updateSettings('svc-a', { env: { B: '2' } });
    expect(orch.getSettings('svc-a')!.env).toEqual({ B: '2' });
    expect(orch.getSettings('svc-a')!.launch!.command).toBe('node server.js');
    expect(saved.projects[projectKey(dir)].launch!.source).toBe('manual');
  });

  it('act start, restart and stop drive the process', async () => {
    addService('svc-a');
    orch.refresh();
    orch.updateSettings('svc-a', { command: LONG });

    await orch.act(['svc-a'], 'start');
    expect(view('svc-a')!.status).toBe('running');
    const pid = view('svc-a')!.pid;

    await orch.act(['svc-a'], 'restart');
    expect(view('svc-a')!.status).toBe('running');
    expect(view('svc-a')!.pid).not.toBe(pid);

    await orch.act(['svc-a'], 'stop');
    expect(view('svc-a')!.status).toBe('stopped');
  }, T);

  it('lists run configs and branches, and saves groups', async () => {
    addService('svc-a');
    addService('svc-b');
    orch.refresh();

    expect(orch.runConfigs('svc-a')).toEqual([]);
    expect(await orch.branches(['svc-a', 'svc-b'])).toEqual(['main', 'staging']);

    orch.saveGroup('front', ['svc-a', 'svc-b']);
    expect(orch.dashboard().groups).toEqual({ front: ['svc-a', 'svc-b'] });
    expect(saved.groups).toEqual({ front: ['svc-a', 'svc-b'] });
    orch.deleteGroup('front');
    expect(orch.dashboard().groups).toEqual({});
  });

  it('switchBranches restarts a running project after switching', async () => {
    const dir = addService('svc-a');
    orch.refresh();
    orch.updateSettings('svc-a', { command: LONG });
    await orch.act(['svc-a'], 'start');
    const pid = view('svc-a')!.pid;

    const [result] = await orch.switchBranches(['svc-a'], 'staging', { stash: false });

    expect(result).toMatchObject({ name: 'svc-a', ok: true, restarted: true, installed: false });
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('staging');
    expect(view('svc-a')!.status).toBe('running');
    expect(view('svc-a')!.pid).not.toBe(pid);
    expect(view('svc-a')!.git!.branch).toBe('staging');
    expect(view('svc-a')!.busy).toBe(false);
    expect(orch.logs('svc-a', 0).some((l) => l.stream === 'sys' && l.text.includes('staging'))).toBe(true);
  }, T);

  it('switchBranches does not start a project that was stopped', async () => {
    addService('svc-a');
    orch.refresh();
    orch.updateSettings('svc-a', { command: LONG });

    const [result] = await orch.switchBranches(['svc-a'], 'staging', { stash: false });

    expect(result).toMatchObject({ ok: true, restarted: false });
    expect(pm.status('svc-a').status).toBe('stopped');
  }, T);

  it('switchBranches leaves a running project untouched when the branch does not exist', async () => {
    addService('svc-a');
    orch.refresh();
    orch.updateSettings('svc-a', { command: LONG });
    await orch.act(['svc-a'], 'start');
    const pid = view('svc-a')!.pid;

    const [result] = await orch.switchBranches(['svc-a'], 'nope', { stash: false });

    expect(result).toMatchObject({ ok: false, reason: 'branch-not-found', restarted: false });
    expect(view('svc-a')!.status).toBe('running');
    expect(view('svc-a')!.pid).toBe(pid);
    expect(orch.logs('svc-a', 0).some((l) => l.text.includes('Arrêt'))).toBe(false);
  }, T);

  it('switchBranches leaves a running dirty project untouched', async () => {
    const dir = addService('svc-a');
    orch.refresh();
    orch.updateSettings('svc-a', { command: LONG });
    await orch.act(['svc-a'], 'start');
    const pid = view('svc-a')!.pid;
    writeFile(dir, 'a.txt', 'changed\n');

    const [result] = await orch.switchBranches(['svc-a'], 'staging', { stash: false });

    expect(result).toMatchObject({ ok: false, reason: 'dirty', restarted: false });
    expect(view('svc-a')!.pid).toBe(pid);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  }, T);

  it('switchBranches rejects a project already busy', async () => {
    addService('svc-a');
    orch.refresh();

    const first = orch.switchBranches(['svc-a'], 'staging', { stash: false });
    expect(view('svc-a')!.busy).toBe(true);
    const second = orch.switchBranches(['svc-a'], 'main', { stash: false });

    expect(await second).toEqual([{ name: 'svc-a', ok: false, reason: 'busy' }]);
    expect((await first)[0].ok).toBe(true);
    expect(view('svc-a')!.busy).toBe(false);
  }, T);

  it('switchBranches continues other projects when one is dirty', async () => {
    const a = addService('svc-a');
    const b = addService('svc-b');
    orch.refresh();
    writeFile(a, 'a.txt', 'changed\n');

    const results = await orch.switchBranches(['svc-a', 'svc-b'], 'staging', { stash: false });

    expect(results.find((r) => r.name === 'svc-a')).toMatchObject({ ok: false, reason: 'dirty' });
    expect(results.find((r) => r.name === 'svc-b')).toMatchObject({ ok: true });
    expect(git(a, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git(b, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('staging');
  }, T);

  it('switchBranches runs npm install when the lock changes and streams it to the logs', async () => {
    // staging change le package-lock.json ; package.json est versionné pour que npm install ait un projet.
    const w = pair.work;
    commitFile(w, 'package.json', JSON.stringify({ name: 'svc-a', version: '1.0.0' }), 'add package.json');
    push(w, 'origin', 'main');
    git(w, 'checkout', 'staging');
    git(w, 'merge', 'main', '--no-edit');
    commitFile(w, 'package-lock.json', '{"name":"svc-a","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"svc-a","version":"1.0.0"}}}\n', 'lock');
    push(w, 'origin', 'staging');
    git(w, 'checkout', 'main');

    cloneRepo(pair.origin, path.join(root, 'svc-a'));
    orch.refresh();

    const [result] = await orch.switchBranches(['svc-a'], 'staging', { stash: false });

    expect(result).toMatchObject({ ok: true, installed: true });
    const text = orch.logs('svc-a', 0).map((l) => l.text).join('\n');
    expect(text).toContain('npm install');
  }, 120_000);

  it('safeRefresh (timer body) swallows a store.save failure and retries the save on the next tick', () => {
    addService('svc-a');
    let fail = true;
    const flaky = createOrchestrator({
      store: {
        load: () => structuredClone(saved),
        save: (st) => {
          if (fail) { fail = false; throw Object.assign(new Error('EPERM: rename state.json'), { code: 'EPERM' }); }
          saved = structuredClone(st);
        },
      },
      pm,
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => flaky.safeRefresh()).not.toThrow();
      expect(errors).toHaveBeenCalledOnce();
      // Le tick suivant réessaie et réussit : le serveur continue de fonctionner.
      expect(() => flaky.safeRefresh()).not.toThrow();
      expect(saved.projects[projectKey(path.join(root, 'svc-a'))]).toBeDefined();
    } finally {
      errors.mockRestore();
    }
  }, T);

  it('does not reuse settings across a root change to a same-named repo', async () => {
    const first = addService('svc-a');
    writeFile(first, '.env', 'A=1\n');
    orch.refresh();
    orch.updateSettings('svc-a', { command: LONG });

    const root2 = path.join(pair.base, 'root2');
    fs.mkdirSync(root2);
    const second = cloneRepo(pair.origin, path.join(root2, 'svc-a'));
    writeFile(second, 'package.json', JSON.stringify({ name: 'svc-a', version: '9.9.9' }));
    writeFile(second, '.env', 'A=2\n');
    orch.setRoot(root2);

    expect(orch.getSettings('svc-a')).toMatchObject({ env: { A: '2' }, launch: null });
    expect(view('svc-a')!.path).toBe(second);
    // Aucune commande pour le nouveau dossier : rien n'est lancé (surtout pas le code de l'autre racine).
    await orch.act(['svc-a'], 'start');
    expect(pm.status('svc-a').status).toBe('stopped');

    orch.setRoot(root);
    expect(orch.getSettings('svc-a')).toMatchObject({ env: { A: '1' }, launch: { command: LONG, cwd: first } });
    expect(Object.keys(saved.projects).sort()).toEqual([projectKey(first), projectKey(second)].sort());
  }, T);

  it('act start/restart skip names that are not in the current root', async () => {
    const dir = addService('svc-a');
    orch.refresh();
    orch.updateSettings('svc-a', { command: LONG });
    fs.mkdirSync(path.join(pair.base, 'elsewhere'));
    orch.setRoot(path.join(pair.base, 'elsewhere'));

    await orch.act(['svc-a'], 'start');
    await orch.act(['svc-a'], 'restart');

    expect(pm.status('svc-a').status).toBe('stopped');
    expect(saved.projects[projectKey(dir)].launch!.command).toBe(LONG);
  }, T);

  it('migrates folder-name keys of an old state to path keys', () => {
    const dir = addService('svc-a');
    writeFile(dir, '.env', 'FROM_DOTENV=1\n');
    const old = { launch: { command: LONG, cwd: dir, source: 'manual' as const }, env: { KEPT: '1' }, importedAt: '2026-01-01T00:00:00.000Z' };
    saved = { root, projects: { 'svc-a': old, 'gone-svc': { ...old, launch: null } }, groups: { g: ['svc-a'] } };

    orch.refresh();

    // Les réglages migrés sont repris tels quels (pas de réimport) et écrits sous la nouvelle clé.
    expect(orch.getSettings('svc-a')).toEqual(old);
    expect(Object.keys(saved.projects).sort()).toEqual(
      [projectKey(dir), projectKey(path.join(root, 'gone-svc'))].sort(),
    );
    expect(saved.groups).toEqual({ g: ['svc-a'] });
  });

  it('act restart is skipped while a branch switch holds the project', async () => {
    addService('svc-a');
    orch.refresh();
    orch.updateSettings('svc-a', { command: LONG });
    await orch.act(['svc-a'], 'start');

    const switching = orch.switchBranches(['svc-a'], 'staging', { stash: false });
    await orch.act(['svc-a'], 'restart');
    const [result] = await switching;

    expect(result).toMatchObject({ ok: true, restarted: true });
    expect(pm.status('svc-a')).toMatchObject({ status: 'running', restarts: 0 });
  }, T);

  it('a branch switch is refused while act holds the project', async () => {
    addService('svc-a');
    orch.refresh();
    orch.updateSettings('svc-a', { command: LONG });
    await orch.act(['svc-a'], 'start');

    const restarting = orch.act(['svc-a'], 'restart');
    expect(view('svc-a')!.busy).toBe(true);
    const [result] = await orch.switchBranches(['svc-a'], 'staging', { stash: false });
    await restarting;

    expect(result).toEqual({ name: 'svc-a', ok: false, reason: 'busy' });
    expect(pm.status('svc-a')).toMatchObject({ status: 'running', restarts: 1 });
    expect(view('svc-a')!.busy).toBe(false);
  }, T);
});
