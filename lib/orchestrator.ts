import { spawn } from 'child_process';
import path from 'path';
import readline from 'readline';
import { scanRoot } from './discovery';
import { detectLaunch, listRunConfigs } from './launch';
import { getGitInfo, listBranches, switchBranch } from './git';
import { ProcessManager } from './process-manager';
import { store } from './store';
import type {
  DashboardPayload,
  DiscoveredRepo,
  GitInfo,
  LogLine,
  ProjectSettings,
  ProjectView,
  RunConfig,
  RunStatus,
  StoredState,
  SwitchResult,
} from './types';

const REFRESH_INTERVAL_MS = 2000;
const GIT_INTERVAL_MS = 10_000;

export interface OrchestratorDeps {
  store: { load(): StoredState; save(s: StoredState): void };
  pm: ProcessManager;
}

const isActive = (status: RunStatus) => status === 'running' || status === 'restarting';

/** `npm install` dans le dépôt, sortie diffusée dans les logs du projet. Résout à true si le code de sortie est 0. */
function runInstall(pm: ProcessManager, name: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('npm install', { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      pm.log(name, 'sys', `✖ npm install impossible : ${(err as Error).message}`);
      resolve(false);
      return;
    }
    // npm écrit ses avertissements sur stderr : ce ne sont pas des erreurs du projet.
    for (const stream of [child.stdout!, child.stderr!]) {
      readline.createInterface({ input: stream }).on('line', (line) => pm.log(name, 'out', line));
    }
    child.once('error', (err) => {
      pm.log(name, 'sys', `✖ npm install impossible : ${err.message}`);
      resolve(false);
    });
    child.once('close', (code) => resolve(code === 0));
  });
}

export function createOrchestrator(deps: OrchestratorDeps) {
  const { pm } = deps;
  let state: StoredState | null = null;
  let rootExists = false;
  let repos = new Map<string, DiscoveredRepo>();
  const gitCache = new Map<string, GitInfo | null>();
  const busy = new Set<string>();
  let started = false;
  let gitRefreshing = false;

  const getState = (): StoredState => (state ??= deps.store.load());
  const persist = () => deps.store.save(getState());

  async function refreshGit(names: string[]): Promise<void> {
    await Promise.all(
      names.map(async (name) => {
        const repo = repos.get(name);
        if (!repo) return;
        const info = await getGitInfo(repo.path).catch(() => null);
        if (repos.has(name)) gitCache.set(name, info);
      }),
    );
  }

  function refresh(): void {
    const scan = scanRoot(getState().root);
    rootExists = scan.rootExists;
    repos = new Map(scan.repos.map((r) => [r.name, r]));

    let changed = false;
    for (const repo of scan.repos) {
      if (repo.kind !== 'service' || getState().projects[repo.name]) continue;
      const { launch, env } = detectLaunch(repo.path);
      getState().projects[repo.name] = { launch, env, importedAt: new Date().toISOString() };
      changed = true;
    }
    if (changed) persist();

    for (const name of gitCache.keys()) if (!repos.has(name)) gitCache.delete(name);
    const fresh = scan.repos.map((r) => r.name).filter((name) => !gitCache.has(name));
    for (const name of fresh) gitCache.set(name, null);
    if (fresh.length > 0) void refreshGit(fresh);
  }

  function init(): void {
    if (started) return;
    started = true;
    pm.cleanupOrphans();
    refresh();

    setInterval(refresh, REFRESH_INTERVAL_MS).unref();
    setInterval(() => {
      if (gitRefreshing) return;
      gitRefreshing = true;
      void refreshGit([...repos.keys()]).finally(() => { gitRefreshing = false; });
    }, GIT_INTERVAL_MS).unref();

    const killAll = () => pm.killAll();
    const onSignal = () => {
      killAll();
      process.exit(0);
    };
    process.on('exit', killAll);
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }

  function dashboard(): DashboardPayload {
    const projects: ProjectView[] = [];
    for (const repo of repos.values()) {
      projects.push({
        name: repo.name,
        kind: repo.kind,
        path: repo.path,
        version: repo.version,
        launch: getState().projects[repo.name]?.launch ?? null,
        git: gitCache.get(repo.name) ?? null,
        missing: false,
        busy: busy.has(repo.name),
        ...pm.status(repo.name),
      });
    }
    // Dossier disparu mais service encore lancé : on le garde visible pour pouvoir l'arrêter.
    for (const [name, settings] of Object.entries(getState().projects)) {
      if (repos.has(name)) continue;
      const status = pm.status(name);
      if (!isActive(status.status)) continue;
      projects.push({
        name,
        kind: 'service',
        path: settings.launch?.cwd ?? '',
        version: null,
        launch: settings.launch,
        git: null,
        missing: true,
        busy: busy.has(name),
        ...status,
      });
    }
    projects.sort((a, b) => a.name.localeCompare(b.name));

    const database = [...repos.values()].find((r) => r.kind === 'database');
    return {
      root: getState().root,
      rootExists,
      dbVersion: database?.version ?? null,
      projects,
      groups: getState().groups,
    };
  }

  async function act(names: string[], action: 'start' | 'stop' | 'restart'): Promise<void> {
    await Promise.all(
      names.map(async (name) => {
        if (busy.has(name) || repos.get(name)?.kind === 'database') return;
        const settings = getState().projects[name];
        if (action === 'stop') return pm.stop(name);
        if (!settings?.launch) return;
        if (action === 'start') return pm.start(name, settings.launch, settings.env);
        return pm.restart(name, settings.launch, settings.env);
      }),
    );
  }

  const getSettings = (name: string): ProjectSettings | null => getState().projects[name] ?? null;

  function updateSettings(name: string, patch: { command?: string; env?: Record<string, string> }): void {
    const settings = getSettings(name);
    if (!settings) throw new Error(`Projet inconnu : ${name}`);
    if (patch.command !== undefined) {
      const cwd = settings.launch?.cwd ?? repos.get(name)?.path;
      if (!cwd) throw new Error(`Dossier introuvable pour ${name}`);
      settings.launch = { command: patch.command, cwd, source: 'manual' };
    }
    if (patch.env !== undefined) settings.env = patch.env;
    persist();
  }

  function reimport(name: string, configKey?: string): ProjectSettings {
    const repo = repos.get(name);
    if (!repo || repo.kind !== 'service') throw new Error(`Projet inconnu : ${name}`);
    const { launch, env } = detectLaunch(repo.path, configKey);
    const settings: ProjectSettings = { launch, env, importedAt: new Date().toISOString() };
    getState().projects[name] = settings;
    persist();
    return settings;
  }

  const runConfigs = (name: string): RunConfig[] => {
    const repo = repos.get(name);
    return repo ? listRunConfigs(repo.path) : [];
  };

  const logs = (name: string, since: number): LogLine[] => pm.logs(name, since);

  async function branches(names: string[]): Promise<string[]> {
    const lists = await Promise.all(
      names.map((name) => {
        const repo = repos.get(name);
        return repo ? listBranches(repo.path) : [];
      }),
    );
    return [...new Set(lists.flat())].sort();
  }

  async function switchOne(name: string, branch: string, opts: { stash: boolean }): Promise<SwitchResult> {
    const repo = repos.get(name);
    if (!repo) return { name, ok: false, reason: 'error', detail: 'projet introuvable' };
    if (busy.has(name)) return { name, ok: false, reason: 'busy' };
    busy.add(name);
    try {
      const log = (text: string) => pm.log(name, 'sys', text);
      const settings = getState().projects[name];
      const wasRunning = isActive(pm.status(name).status);

      log(`⇄ Bascule vers ${branch}`);
      if (wasRunning) {
        log('■ Arrêt avant la bascule');
        await pm.stop(name);
      }

      let outcome: Awaited<ReturnType<typeof switchBranch>>;
      try {
        outcome = await switchBranch(repo.path, branch, opts);
      } catch (err) {
        outcome = { ok: false, reason: 'error', detail: (err as Error).message, lockChanged: false };
      }
      log(outcome.ok ? `✔ Sur la branche ${branch}` : `✖ Bascule impossible (${outcome.reason}) : ${outcome.detail ?? ''}`);

      let installed = false;
      let detail = outcome.detail;
      if (outcome.lockChanged) {
        log('▶ package-lock.json modifié — npm install');
        installed = await runInstall(pm, name, repo.path);
        log(installed ? '✔ npm install terminé' : '✖ npm install a échoué');
        if (!installed) detail = [detail, 'npm install a échoué'].filter(Boolean).join(' — ');
      }

      // Relance même si la bascule a échoué : on ne laisse pas éteint un service qui tournait.
      let restarted = false;
      if (wasRunning && settings?.launch) {
        log('▶ Relance');
        pm.start(name, settings.launch, settings.env);
        restarted = true;
      }

      await refreshGit([name]);
      return { name, ok: outcome.ok, reason: outcome.reason, detail, installed, restarted };
    } finally {
      busy.delete(name);
    }
  }

  const switchBranches = (names: string[], branch: string, opts: { stash: boolean }): Promise<SwitchResult[]> =>
    Promise.all(names.map((name) => switchOne(name, branch, opts)));

  function setRoot(root: string): void {
    getState().root = root;
    persist();
    refresh();
  }

  function saveGroup(name: string, members: string[]): void {
    getState().groups[name] = [...new Set(members)];
    persist();
  }

  function deleteGroup(name: string): void {
    delete getState().groups[name];
    persist();
  }

  return {
    init, refresh, dashboard, act, getSettings, updateSettings, reimport, runConfigs, logs,
    branches, switchBranches, setRoot, saveGroup, deleteGroup,
  };
}

declare global {
  var __orch: ReturnType<typeof createOrchestrator> | undefined;
}

// Singleton partagé entre instrumentation.ts et les routes, qui peuvent vivre dans des bundles distincts.
export const orchestrator = (globalThis.__orch ??= createOrchestrator({
  store,
  pm: new ProcessManager({ pidFile: path.join(process.cwd(), 'data', 'pids.json') }),
}));
