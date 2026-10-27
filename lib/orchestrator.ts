import { spawn } from 'child_process';
import path from 'path';
import readline from 'readline';
import { childEnv } from './child-env';
import { formatDuration, killTreeAsync } from './kill-tree';
import { scanRoot } from './discovery';
import { detectLaunch, listRunConfigs } from './launch';
import { applySwitch, checkSwitch, getGitInfo, listBranches, type SwitchBranchResult, type SwitchCheck } from './git';
import { ProcessManager } from './process-manager';
import { store } from './store';
import type {
  DashboardPayload,
  DiscoveredRepo,
  GitInfo,
  LaunchSpec,
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
const INSTALL_TIMEOUT_MS = 10 * 60_000;

export interface OrchestratorDeps {
  store: { load(): StoredState; save(s: StoredState): void };
  pm: ProcessManager;
  /** Délai de `npm install` après bascule (défaut 10 min). */
  installTimeoutMs?: number;
  /** Délai des fetch/pull de la bascule (défaut NETWORK_TIMEOUT_MS). */
  gitTimeoutMs?: number;
}

const isActive = (status: RunStatus) => status === 'running' || status === 'restarting';

/**
 * Clé des réglages d'un dépôt : son chemin absolu normalisé (insensible à la casse sous Windows).
 * Deux racines contenant un dossier du même nom ne partagent donc pas leurs réglages.
 */
export function projectKey(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Ancien format (clé = nom du dossier) : la clé devient le chemin du dossier dans la racine. Renvoie true si l'état a changé. */
export function migrateProjectKeys(state: StoredState): boolean {
  let changed = false;
  for (const [key, settings] of Object.entries(state.projects)) {
    if (path.isAbsolute(key)) continue;
    const migrated = projectKey(path.join(state.root, key));
    if (!(migrated in state.projects)) state.projects[migrated] = settings;
    delete state.projects[key];
    changed = true;
  }
  return changed;
}

type InstallOutcome = 'ok' | 'failed' | 'timeout';

/**
 * `npm install` dans le dépôt, sortie diffusée dans les logs du projet.
 * Au-delà de `timeoutMs`, l'arbre de process est tué et le résultat est 'timeout'.
 */
function runInstall(pm: ProcessManager, name: string, cwd: string, timeoutMs: number): Promise<InstallOutcome> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('npm install', { cwd, env: childEnv(), shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      pm.log(name, 'sys', `✖ npm install impossible : ${(err as Error).message}`);
      resolve('failed');
      return;
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTreeAsync(child.pid);
    }, timeoutMs);
    // npm écrit ses avertissements sur stderr : ce ne sont pas des erreurs du projet.
    for (const stream of [child.stdout!, child.stderr!]) {
      readline.createInterface({ input: stream }).on('line', (line) => pm.log(name, 'out', line));
    }
    child.once('error', (err) => {
      clearTimeout(timer);
      pm.log(name, 'sys', `✖ npm install impossible : ${err.message}`);
      resolve('failed');
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(timedOut ? 'timeout' : code === 0 ? 'ok' : 'failed');
    });
  });
}

export function createOrchestrator(deps: OrchestratorDeps) {
  const { pm } = deps;
  let state: StoredState | null = null;
  let rootExists = false;
  let repos = new Map<string, DiscoveredRepo>();
  const gitCache = new Map<string, GitInfo | null>();
  const busy = new Set<string>();
  // Clé des réglages de chaque service lancé, pour garder visible (et arrêtable) un service dont le dossier a disparu.
  const launched = new Map<string, string>();
  let started = false;
  let gitRefreshing = false;
  // Import non encore écrit sur disque (save a échoué) : retenté au prochain refresh.
  let unsaved = false;

  function getState(): StoredState {
    if (!state) {
      state = deps.store.load();
      if (migrateProjectKeys(state)) unsaved = true; // écrit au prochain refresh
    }
    return state;
  }
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
    // Même nom mais autre dossier (racine changée) : l'info git en cache n'est plus la sienne.
    for (const repo of scan.repos) if (repos.get(repo.name)?.path !== repo.path) gitCache.delete(repo.name);
    repos = new Map(scan.repos.map((r) => [r.name, r]));

    for (const repo of scan.repos) {
      const key = projectKey(repo.path);
      if (repo.kind !== 'service' || getState().projects[key]) continue;
      const { launch, env } = detectLaunch(repo.path);
      getState().projects[key] = { launch, env, importedAt: new Date().toISOString() };
      unsaved = true;
    }
    if (unsaved) {
      persist();
      unsaved = false;
    }

    for (const name of gitCache.keys()) if (!repos.has(name)) gitCache.delete(name);
    const fresh = scan.repos.map((r) => r.name).filter((name) => !gitCache.has(name));
    for (const name of fresh) gitCache.set(name, null);
    if (fresh.length > 0) void refreshGit(fresh);
  }

  /** Corps du timer : une erreur (ex. EPERM sur state.json) ne doit jamais faire tomber le serveur et ses services. */
  function safeRefresh(): void {
    try {
      refresh();
    } catch (err) {
      console.error('[orchestrator] refresh failed:', err);
    }
  }

  function init(): void {
    if (started) return;
    started = true;
    pm.cleanupOrphans();
    refresh();

    setInterval(safeRefresh, REFRESH_INTERVAL_MS).unref();
    setInterval(() => {
      if (gitRefreshing) return;
      gitRefreshing = true;
      try {
        void refreshGit([...repos.keys()])
          .catch((err) => console.error('[orchestrator] git refresh failed:', err))
          .finally(() => { gitRefreshing = false; });
      } catch (err) {
        gitRefreshing = false;
        console.error('[orchestrator] git refresh failed:', err);
      }
    }, GIT_INTERVAL_MS).unref();

    const killAll = () => pm.killAll();
    const onSignal = () => {
      killAll();
      process.exit(0);
    };
    process.on('exit', killAll);
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    process.once('SIGHUP', onSignal);
    process.once('SIGBREAK', onSignal);
  }

  function dashboard(): DashboardPayload {
    const projects: ProjectView[] = [];
    for (const repo of repos.values()) {
      projects.push({
        name: repo.name,
        kind: repo.kind,
        path: repo.path,
        version: repo.version,
        launch: settingsOf(repo.name)?.launch ?? null,
        git: gitCache.get(repo.name) ?? null,
        missing: false,
        busy: busy.has(repo.name),
        ...pm.status(repo.name),
      });
    }
    // Dossier disparu mais service encore lancé : on le garde visible pour pouvoir l'arrêter.
    for (const [name, key] of launched) {
      if (repos.has(name)) continue;
      const status = pm.status(name);
      const settings = getState().projects[key];
      if (!isActive(status.status) || !settings) {
        launched.delete(name);
        continue;
      }
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

  /** Réglages d'un dépôt du dossier racine courant (undefined pour un nom absent du scan). */
  const settingsOf = (name: string): ProjectSettings | undefined => {
    const repo = repos.get(name);
    return repo ? getState().projects[projectKey(repo.path)] : undefined;
  };

  async function startService(name: string, repoPath: string, launch: LaunchSpec, env: Record<string, string>, restart: boolean): Promise<void> {
    launched.set(name, projectKey(repoPath));
    if (restart) await pm.restart(name, launch, env);
    else pm.start(name, launch, env);
  }

  async function act(names: string[], action: 'start' | 'stop' | 'restart'): Promise<void> {
    await Promise.all(
      names.map(async (name) => {
        if (busy.has(name) || repos.get(name)?.kind === 'database') return;
        // Verrou partagé avec la bascule de branche : un redémarrage ne peut pas s'intercaler.
        busy.add(name);
        try {
          // Arrêt possible même si le dossier a disparu ; lancement seulement pour un dépôt de la racine courante.
          if (action === 'stop') return await pm.stop(name);
          const repo = repos.get(name);
          const settings = settingsOf(name);
          if (!repo || !settings?.launch) return;
          await startService(name, repo.path, settings.launch, settings.env, action === 'restart');
        } finally {
          busy.delete(name);
        }
      }),
    );
  }

  const getSettings = (name: string): ProjectSettings | null => {
    const key = repos.has(name) ? projectKey(repos.get(name)!.path) : launched.get(name);
    return key ? getState().projects[key] ?? null : null;
  };

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
    getState().projects[projectKey(repo.path)] = settings;
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
      const switchOpts = { ...opts, timeoutMs: deps.gitTimeoutMs };
      const logFailure = (o: SwitchBranchResult) => log(`✖ Bascule impossible (${o.reason}) : ${o.detail ?? ''}`);
      const settings = settingsOf(name);

      log(`⇄ Bascule vers ${branch}`);
      // Pré-vérification avant tout arrêt : un projet refusé (modifs, branche absente) n'est pas touché.
      let check: SwitchCheck;
      try {
        check = await checkSwitch(repo.path, branch, switchOpts);
      } catch (err) {
        check = { ok: false, result: { ok: false, reason: 'error', detail: (err as Error).message, lockChanged: false } };
      }
      if (!check.ok) {
        logFailure(check.result);
        await refreshGit([name]);
        const { reason, detail } = check.result;
        return { name, ok: false, reason, detail, installed: false, restarted: false };
      }

      const wasRunning = isActive(pm.status(name).status);
      if (wasRunning) {
        log('■ Arrêt avant la bascule');
        await pm.stop(name);
      }

      let outcome: SwitchBranchResult;
      try {
        outcome = await applySwitch(repo.path, check.plan, switchOpts);
      } catch (err) {
        outcome = { ok: false, reason: 'error', detail: (err as Error).message, lockChanged: false };
      }
      if (outcome.ok) log(`✔ Sur la branche ${branch}`);
      else logFailure(outcome);

      let installed = false;
      let detail = outcome.detail;
      if (outcome.lockChanged) {
        log('▶ package-lock.json modifié — npm install');
        const install = await runInstall(pm, name, repo.path, deps.installTimeoutMs ?? INSTALL_TIMEOUT_MS);
        installed = install === 'ok';
        const problem = install === 'timeout'
          ? `npm install interrompu après ${formatDuration(deps.installTimeoutMs ?? INSTALL_TIMEOUT_MS)}`
          : 'npm install a échoué';
        log(installed ? '✔ npm install terminé' : `✖ ${problem}`);
        if (!installed) detail = [detail, problem].filter(Boolean).join(' — ');
      }

      // Relance même si l'application a échoué : on ne laisse pas éteint un service qui tournait.
      let restarted = false;
      if (wasRunning && settings?.launch) {
        log('▶ Relance');
        await startService(name, repo.path, settings.launch, settings.env, false);
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
    init, refresh, safeRefresh, dashboard, act, getSettings, updateSettings, reimport, runConfigs, logs,
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
