# Refonte d'Orchestrator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'orchestrator actuel (liste `apps.config.json` écrite à la main) par un tableau de bord local qui découvre les dépôts d'un dossier racine, les lance avec les variables importées d'IntelliJ/.env, montre logs/statut/version, et change de branche sur un ou plusieurs projets.

**Architecture:** Serveur Next.js local. Le cœur est dans `lib/` en modules purs et testables (découverte, parseur IntelliJ, git, gestion de process, stockage), assemblés par une façade `lib/orchestrator.ts` singleton (`globalThis`) initialisée dans `instrumentation.ts`. L'UI reçoit l'état via SSE toutes les 2 s, les logs par polling incrémental, et agit via des routes `app/api/**`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind v4, Vitest 4, `fast-xml-parser` (nouvelle dépendance, parsing de `.idea/workspace.xml`), `git` CLI via `child_process.execFile`.

**Spec:** `docs/superpowers/specs/2026-10-27-refonte-orchestrator-design.md`

## Global Constraints

- Windows 11, Node 22. Arrêt d'un service = arbre complet : `taskkill /pid <pid> /T /F`.
- **Jamais d'écriture dans un dépôt géré** (`.env`, `.idea/`, fichiers) — seules exceptions : `git stash/checkout/pull/fetch` explicitement demandés et `npm install`.
- Stockage unique : `data/state.json` (écriture atomique tmp + rename), `data/` ajouté au `.gitignore`.
- Dossier racine par défaut : `C:\Repositories\AtoolDev\semaphore`.
- Serveur lié à `127.0.0.1` uniquement (`next dev -H 127.0.0.1`, `next start -H 127.0.0.1`).
- Pas de démarrage automatique des services au lancement d'Orchestrator.
- Crash : relance auto avec backoff ; au-delà de **5 crashs en 60 s**, plus de relance, statut `failed` jusqu'à relance manuelle.
- Arrêt d'Orchestrator ⇒ tous les services lancés sont tués.
- Changement de branche : jamais de stash implicite, stash non réappliqué, `pull --ff-only`, `npm install` seulement si le blob `package-lock.json` a changé, redémarrage si le projet tournait, chaque projet indépendant.
- Priorité des variables à l'import : `.env` l'emporte sur IntelliJ.
- Textes de l'UI en français.
- Next 16 : lire `node_modules/next/dist/docs/` avant d'écrire une route (cf. `AGENTS.md`) ; `params` des routes dynamiques est une `Promise`.

## Review Focus

1. Valeurs IntelliJ contenant des entités XML (`&amp;`, `&quot;`) ou `$PROJECT_DIR$` → décodées / résolues vers le chemin du dépôt (test Task 3).
2. Projet dont toutes les configs IntelliJ sont Docker ou absentes (cas `meter-semaphore`) ou `workspace.xml` illisible → retombe sur `npm start` du `package.json`, sans exception (test Task 3).
3. Branche qui n'existe que sur `origin` (pas de branche locale) → checkout crée la branche locale qui suit l'origine (test Task 4).
4. Dossier racine inexistant → liste vide + `rootExists: false`, pas de crash (test Task 2).
5. Action (start/switch) envoyée pendant qu'un changement de branche est en cours sur le même projet → refusée (`busy`), pas d'exécution concurrente (test Task 6).

---

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/types.ts` | Tous les types partagés (remplace `types/index.ts`) |
| `lib/store.ts` | Lecture/écriture atomique de `data/state.json` |
| `lib/discovery.ts` | Scan du dossier racine → dépôts |
| `lib/intellij.ts` | Parse `.idea/workspace.xml` → configs de lancement |
| `lib/launch.ts` | Déduit commande + variables d'un dépôt (IntelliJ puis package.json, + `.env`) |
| `lib/git.ts` | Infos git, liste des branches, changement de branche |
| `lib/process-manager.ts` | Spawn/kill, logs en anneau, politique de crash, orphelins |
| `lib/orchestrator.ts` | Façade + singleton |
| `lib/utils.ts` | Gardé (`parseEnv`, `stripAnsi`, `formatUptime`, `isErrorLog`) |
| `app/api/**` | Routes fines vers la façade |
| `components/*.tsx`, `app/page.tsx` | UI |

Supprimés : `types/`, `bin/`, `apps.config.json`, `app/api/apps/**`, `app/api/groups/**`, `app/api/validate-path/**`, tous les `components/*.tsx` actuels, script `cli`/`setup` du `package.json`.

---

### Task 1: Table rase, types et stockage

**Files:**
- Delete: voir liste « Supprimés » ci-dessus
- Create: `lib/types.ts`, `lib/store.ts`, `tests/lib/store.test.ts`
- Modify: `.gitignore` (ajouter `/data/`), `package.json` (scripts `dev`/`start` avec `-H 127.0.0.1`, retirer `cli`/`setup`, ajouter `fast-xml-parser`), `lib/orchestrator.ts` → remplacé par un stub `export const orchestrator = { init() {} }` pour que le build passe, `app/page.tsx` → stub « Refonte en cours », `app/api/sse/route.ts` → supprimé (recréé Task 6)

**Interfaces — Produces** (`lib/types.ts`, exact) :

```ts
export type ProjectKind = 'service' | 'database';
export interface DiscoveredRepo { name: string; path: string; kind: ProjectKind; version: string | null; }
export interface LaunchSpec { command: string; cwd: string; source: 'intellij' | 'package.json' | 'manual'; configName?: string; }
export interface RunConfig { key: string; name: string; type: 'node' | 'npm'; temporary: boolean; command: string; cwd: string; env: Record<string, string>; }
export interface ProjectSettings { launch: LaunchSpec | null; env: Record<string, string>; importedAt: string; }
export interface StoredState { root: string; projects: Record<string, ProjectSettings>; groups: Record<string, string[]>; }
export interface GitInfo { branch: string; commit: string; message: string; dirtyFiles: number; stashCount: number; ahead: number; behind: number; }
export type RunStatus = 'stopped' | 'running' | 'restarting' | 'failed';
export interface CrashInfo { at: number; exitCode: number | null; tail: string[]; }
export interface LogLine { seq: number; ts: number; stream: 'out' | 'err' | 'sys'; text: string; }
export interface ProcessStatus { status: RunStatus; pid: number | null; uptimeMs: number; restarts: number; lastCrash: CrashInfo | null; }
export interface ProjectView extends ProcessStatus { name: string; kind: ProjectKind; path: string; version: string | null; launch: LaunchSpec | null; git: GitInfo | null; missing: boolean; busy: boolean; }
export type SwitchFailure = 'dirty' | 'branch-not-found' | 'not-fast-forward' | 'busy' | 'error';
export interface SwitchResult { name: string; ok: boolean; reason?: SwitchFailure; detail?: string; installed?: boolean; restarted?: boolean; }
export interface DashboardPayload { root: string; rootExists: boolean; dbVersion: string | null; projects: ProjectView[]; groups: Record<string, string[]>; }
```

`lib/store.ts` : `export const DEFAULT_ROOT = 'C:\\Repositories\\AtoolDev\\semaphore'`, `export function createStore(filePath: string): { load(): StoredState; save(state: StoredState): void }`, `export const store = createStore(path.join(process.cwd(), 'data', 'state.json'))`.

- [ ] **Step 1: Write failing tests** `tests/lib/store.test.ts` (fichier dans un `fs.mkdtempSync(os.tmpdir())`) :
  - `load returns defaults when file is missing` → `{ root: DEFAULT_ROOT, projects: {}, groups: {} }`
  - `load returns defaults when file is corrupt JSON` (écrire `"{oops"`)
  - `save then load round-trips` (avec un projet et un groupe)
  - `save creates parent directory and leaves no .tmp file`
- [ ] **Step 2:** `npx vitest run tests/lib/store.test.ts` → FAIL (module introuvable)
- [ ] **Step 3:** Faire les suppressions/stubs, créer `lib/types.ts`, implémenter `lib/store.ts` (écriture `${file}.tmp` puis `renameSync`, `mkdirSync(recursive)`), `npm install fast-xml-parser`.
- [ ] **Step 4:** `npx vitest run` → PASS ; `npx tsc --noEmit` → 0 erreur ; `npm run build` → OK
- [ ] **Step 5:** `git add -A && git commit -m "refactor: table rase, types et stockage data/state.json"`

---

### Task 2: Découverte du dossier racine

**Files:** Create `lib/discovery.ts`, `tests/lib/discovery.test.ts`

**Interfaces:**
- Produces: `export function scanRoot(root: string): { rootExists: boolean; repos: DiscoveredRepo[] }` (trié par nom)
- Règles : un sous-dossier direct est un dépôt s'il contient `.git` (dossier **ou** fichier — worktrees). `package.json` présent ⇒ `kind: 'service'`, `version` = son champ `version` (null si absent/illisible). Sinon, `version.md` présent ⇒ `kind: 'database'`, `version` = première ligne non vide trimée. Sinon ignoré. Ne jamais lancer git ici (scan appelé toutes les 2 s).

- [ ] **Step 1: Failing tests** (arborescence construite dans un tmpdir) :
  - `detects a service with its package.json version` → `{ name: 'stock-semaphore', kind: 'service', version: '2.8.1' }`
  - `detects the database repo from version.md` → `{ kind: 'database', version: '5.9.1' }` pour un contenu `"\n5.9.1\n"`
  - `ignores folders without .git` et `ignores files at root`
  - `accepts .git as a file` (worktree)
  - `returns rootExists false and no repos for a missing root` *(Review Focus 4)*
  - `null version when package.json is invalid JSON`
- [ ] **Step 2:** `npx vitest run tests/lib/discovery.test.ts` → FAIL
- [ ] **Step 3:** Implémenter `scanRoot` (fs sync).
- [ ] **Step 4:** → PASS
- [ ] **Step 5:** `git commit -m "feat: découverte des dépôts du dossier racine"`

---

### Task 3: Configs IntelliJ et déduction du lancement

**Files:** Create `lib/intellij.ts`, `lib/launch.ts`, `tests/lib/intellij.test.ts`, `tests/lib/launch.test.ts`

**Interfaces:**
- Produces `lib/intellij.ts` : `export function parseRunConfigs(xml: string, projectDir: string): { selected: string | null; configs: RunConfig[] }`
- Produces `lib/launch.ts` : `export function detectLaunch(repoPath: string): { launch: LaunchSpec | null; env: Record<string, string> }`
- Consumes : `parseEnv` de `lib/utils.ts`.

Règles de `parseRunConfigs` (format réel observé dans les dépôts Semaphore) :
- Lire `<component name="RunManager" selected="…">` ; `selected` a la forme `<préfixe>.<nom>` : `Node.js.app.js`, `npm.start`, `Docker.Dockerfile`.
- `type="NodeJSConfigurationType"` avec `path-to-js-file` → `type:'node'`, `key: 'Node.js.' + name`, `command = ['node', node-parameters, path-to-js-file, application-parameters].filter(Boolean).join(' ')`, `cwd = working-dir`.
- `type="js.build_tools.npm"` → `type:'npm'`, `key: 'npm.' + name`, `command = 'npm ' + <command value> + (scripts ? ' ' + scripts.join(' ') : '')` (ex. `npm run start`, `npm start`), `cwd = dirname(package-json)`.
- Tout autre type (Docker, Karma, JavascriptDebugType, `default="true"`) est ignoré.
- `env` = `<envs><env name value/></envs>` de la config. Entités XML décodées ; `$PROJECT_DIR$` remplacé par `projectDir` partout.
- Utiliser `fast-xml-parser` avec `ignoreAttributes: false`, attributs toujours en tableau-safe (`isArray` pour `configuration`, `env`, `script`).

Règles de `detectLaunch` :
- Lit `<repo>/.idea/workspace.xml` s'il existe (toute erreur de lecture/parsing ⇒ comme absent).
- Choix : config dont `key === selected` ; sinon la première non temporaire ; sinon la première. → `source:'intellij'`, `configName`.
- Aucune config supportée ⇒ si `package.json` a `scripts.start` ⇒ `{ command: 'npm start', cwd: repoPath, source: 'package.json' }` ; sinon `launch: null`.
- `env` = env de la config choisie, puis écrasé par `<repo>/.env` s'il existe.
- Lecture seule : aucun fichier écrit.

- [ ] **Step 1: Failing tests** `intellij.test.ts` (XML en chaînes inline, valeurs fictives) :
  - `parses a Node.js config with node parameters` → `command: 'node --inspect-brk app.js'`, `cwd: 'C:/x/base'` pour `working-dir="$PROJECT_DIR$"`, `projectDir='C:/x/base'`
  - `parses an npm run config` (`command value="run"`, script `start`) → `'npm run start'`, cwd = dossier du `package-json`
  - `parses an npm start config without scripts` → `'npm start'`
  - `reads selected attribute` → `'npm.start'`
  - `decodes XML entities and $PROJECT_DIR$ in env values` → `value="a&amp;b&quot;c"` ⇒ `'a&b"c'`, `value="$PROJECT_DIR$/jwt"` ⇒ `'C:/x/base/jwt'` *(Review Focus 1)*
  - `ignores docker and karma configurations`
- [ ] **Step 2: Failing tests** `launch.test.ts` (dépôts factices en tmpdir) :
  - `uses the selected IntelliJ config` (deux configs, `selected="Node.js.test"`) → `configName: 'test'`
  - `falls back to first non-temporary config when nothing selected`
  - `falls back to npm start when only docker configs exist` *(Review Focus 2)*
  - `falls back to npm start when workspace.xml is malformed` *(Review Focus 2)*
  - `returns null launch when nothing is runnable`
  - `.env values override IntelliJ env` (`DB_HOST` dans les deux)
  - `does not write anything in the repo` (snapshot `readdirSync` récursif avant/après identique)
- [ ] **Step 3:** `npx vitest run tests/lib/intellij.test.ts tests/lib/launch.test.ts` → FAIL
- [ ] **Step 4:** Implémenter les deux modules.
- [ ] **Step 5:** → PASS ; puis contrôle réel en lecture seule : `npx tsx -e "import {detectLaunch} from './lib/launch'; for (const p of ['base','stock','navigation','meter','front']) { const r = detectLaunch('C:/Repositories/AtoolDev/semaphore/'+p+'-semaphore'); console.log(p, r.launch?.command, Object.keys(r.env).length) }"` → base `node app.js`, stock `node app.js`, navigation `npm run start`, meter `npm start`, front `npm start` (ou `npm run start`), compteurs de variables > 0 pour base/stock/navigation. **Ne jamais afficher les valeurs.**
- [ ] **Step 6:** `git commit -m "feat: import des configs de lancement IntelliJ et .env"`

---

### Task 4: Git

**Files:** Create `lib/git.ts`, `tests/lib/git.test.ts`

**Interfaces — Produces :**
- `export function getGitInfo(cwd: string): Promise<GitInfo | null>` — null si pas un dépôt. `dirtyFiles` = fichiers suivis modifiés (`git status --porcelain --untracked-files=no`). `stashCount` = lignes de `git stash list`. `ahead/behind` via `rev-list --left-right --count HEAD...@{u}` (0/0 sans upstream). `commit` = hash court, `message` = sujet.
- `export function listBranches(cwd: string): Promise<string[]>` — locales + `refs/remotes/origin/*` sans préfixe, dédupliquées, triées, sans `HEAD`.
- `export function switchBranch(cwd: string, branch: string, opts: { stash: boolean }): Promise<{ ok: boolean; reason?: 'dirty' | 'branch-not-found' | 'not-fast-forward' | 'error'; detail?: string; lockChanged: boolean }>`

Algorithme de `switchBranch` (ordre exact) :
1. `dirtyFiles > 0` : si `!opts.stash` ⇒ `{ ok:false, reason:'dirty', detail:'<n> fichiers modifiés' }` sans rien toucher ; sinon `git stash push -m "orchestrator: avant bascule vers <branch>"`.
2. `git fetch origin --prune` — échec toléré (hors ligne), mentionné dans `detail`.
3. Branche absente en local **et** sur `origin` ⇒ `branch-not-found` (si on a stashé à l'étape 1, le stash reste, c'est voulu).
4. `lockBefore = git rev-parse HEAD:package-lock.json` (null si absent).
5. `git checkout <branch>` (crée la branche de suivi si elle n'existe que sur origin).
6. Si upstream : `git pull --ff-only` ; échec ⇒ `{ ok:false, reason:'not-fast-forward', detail:'basculé sur <branch> mais pas à jour' }`.
7. `lockChanged = lockBefore !== git rev-parse HEAD:package-lock.json`.

Utiliser `execFile('git', args, { cwd })` promisifié, jamais de shell.

- [ ] **Step 1: Failing tests** — helper qui crée en tmpdir un dépôt bare `origin` + un clone `work` avec commits sur `main` et `staging` (git config user.name/email locaux) :
  - `getGitInfo reports branch, short commit, message`
  - `getGitInfo counts dirty tracked files and ignores untracked`
  - `getGitInfo returns null outside a repo`
  - `listBranches merges local and origin branches`
  - `switchBranch refuses when dirty and touches nothing` (fichier toujours modifié, branche inchangée)
  - `switchBranch with stash parks changes and does not pop them` → `stashCount === 1`, arbre propre
  - `switchBranch checks out a branch that only exists on origin` *(Review Focus 3)*
  - `switchBranch reports branch-not-found`
  - `switchBranch reports not-fast-forward when local branch diverged` (commit local + commit distant différents)
  - `switchBranch sets lockChanged only when package-lock.json differs`
- [ ] **Step 2:** `npx vitest run tests/lib/git.test.ts` → FAIL
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS
- [ ] **Step 5:** `git commit -m "feat: infos git et changement de branche sûr"`

---

### Task 5: Gestionnaire de process

**Files:** Create `lib/process-manager.ts`, `tests/lib/process-manager.test.ts`

**Interfaces — Produces :**

```ts
export interface ProcessManagerOptions { pidFile: string; maxLogLines?: number /* 5000 */; crashLimit?: number /* 5 */; crashWindowMs?: number /* 60_000 */; backoffMs?: (crashCount: number) => number /* min(1500*2^(n-1), 10_000) */; }
export class ProcessManager {
  constructor(opts: ProcessManagerOptions);
  start(name: string, spec: LaunchSpec, env: Record<string, string>): void;   // no-op si déjà running
  stop(name: string): Promise<void>;                                          // résout quand le process est sorti
  restart(name: string, spec: LaunchSpec, env: Record<string, string>): Promise<void>;
  status(name: string): ProcessStatus;                                        // 'stopped' par défaut
  logs(name: string, sinceSeq: number): LogLine[];                            // lignes avec seq > sinceSeq
  killAll(): void;                                                            // synchrone (utilisable dans process.on('exit'))
  cleanupOrphans(): void;                                                     // tue les PIDs restés dans pidFile d'un run précédent puis vide le fichier
}
```

Comportement :
- `spawn(spec.command, { cwd: spec.cwd, env: { ...process.env, ...env }, shell: true, stdio: ['ignore','pipe','pipe'] })` ; lignes stdout ⇒ `'out'`, stderr ⇒ `'err'`, messages d'Orchestrator ⇒ `'sys'` ; `stripAnsi` ; anneau de `maxLogLines` ; `seq` croissant par projet, jamais réinitialisé entre redémarrages.
- Le `pidFile` contient `{ [name]: pid }` des process vivants (mis à jour à chaque start/exit).
- Sortie non demandée = crash : `lastCrash = { at, exitCode, tail: 20 dernières lignes 'err' (ou 'out' si aucune) }`, ligne `'sys'` « ✖ Planté (code X) — relance dans Ns », statut `restarting`, relance après `backoffMs(nbCrashsDansFenêtre)`. Si `crashLimit` crashs dans `crashWindowMs` ⇒ statut `failed`, ligne `'sys'` « ✖ 5 plantages en 60 s — relance automatique arrêtée », plus de relance.
- `start` manuel remet le compteur de crashs à zéro ; `lastCrash` conservé jusqu'au prochain démarrage réussi (le process vit > 10 s) — l'UI l'affiche.
- Kill Windows : `taskkill /pid <pid> /T /F` (`execFileSync` dans `killAll`, `execFile` sinon) ; autres OS : `process.kill(-pid)` avec `detached:true`.

- [ ] **Step 1: Failing tests** (commandes `node -e "…"` ; options de test `backoffMs: () => 50`, `crashWindowMs: 60_000`, pidFile en tmpdir) :
  - `captures stdout and stderr with increasing seq` puis `logs(name, seq)` ne renvoie que les nouvelles
  - `passes env to the child` (`console.log(process.env.FOO)`)
  - `stop resolves once the process tree is gone and status is stopped` (process `setInterval`)
  - `restarts after a crash and records lastCrash with stderr tail` (`console.error('boom'); process.exit(3)` ⇒ `lastCrash.exitCode === 3`, `tail` contient `boom`)
  - `gives up after 5 crashes in the window` ⇒ `status === 'failed'`, plus de nouveau pid après 500 ms
  - `manual start after failed resets the counter`
  - `trims logs to maxLogLines`
  - `killAll kills every running child synchronously`
  - `cleanupOrphans kills pids left in pidFile` (spawner un `node -e setInterval` détaché, écrire son pid dans le fichier, appeler, vérifier `process.kill(pid, 0)` lève)
- [ ] **Step 2:** `npx vitest run tests/lib/process-manager.test.ts` → FAIL
- [ ] **Step 3:** Implémenter (reprendre la logique `taskkill` et le parsing de lignes `readline` de l'ancien `lib/orchestrator.ts`, visible via `git show HEAD~5:lib/orchestrator.ts`).
- [ ] **Step 4:** → PASS (timeout de test 15 s)
- [ ] **Step 5:** `git commit -m "feat: gestionnaire de process avec logs et politique de crash"`

---

### Task 6: Façade orchestrator, API et SSE

**Files:**
- Create: `lib/orchestrator.ts` (remplace le stub), `tests/lib/orchestrator.test.ts`
- Create routes : `app/api/sse/route.ts`, `app/api/projects/action/route.ts`, `app/api/projects/[name]/settings/route.ts`, `app/api/projects/[name]/reimport/route.ts`, `app/api/projects/[name]/logs/route.ts`, `app/api/branches/route.ts`, `app/api/branches/switch/route.ts`, `app/api/settings/route.ts`, `app/api/groups/route.ts`
- Modify: `instrumentation.ts`

**Interfaces:**
- Consumes : Tasks 1–5.
- Produces :

```ts
export interface OrchestratorDeps { store: { load(): StoredState; save(s: StoredState): void }; pm: ProcessManager; }
export function createOrchestrator(deps: OrchestratorDeps): {
  init(): void;                         // cleanupOrphans, refresh, timers (refresh 2 s, git 10 s), hooks exit/SIGINT/SIGTERM → pm.killAll()
  refresh(): void;                      // scanRoot ; pour tout service sans settings : detectLaunch + save (importedAt ISO)
  dashboard(): DashboardPayload;        // git depuis cache ; projets stockés mais disparus ⇒ omis sauf s'ils tournent (missing: true)
  act(names: string[], action: 'start' | 'stop' | 'restart'): Promise<void>; // ignore database, launch null et busy
  getSettings(name: string): ProjectSettings | null;
  updateSettings(name: string, patch: { command?: string; env?: Record<string, string> }): void; // command ⇒ source 'manual' ; ne redémarre pas
  reimport(name: string): ProjectSettings;  // relance detectLaunch, remplace launch + env
  logs(name: string, since: number): LogLine[];
  branches(names: string[]): Promise<string[]>;  // union
  switchBranches(names: string[], branch: string, opts: { stash: boolean }): Promise<SwitchResult[]>;
  setRoot(root: string): void;
  saveGroup(name: string, members: string[]): void;
  deleteGroup(name: string): void;
};
export const orchestrator: ReturnType<typeof createOrchestrator>; // singleton via globalThis.__orch, store = store de lib/store.ts, pidFile = data/pids.json
```

`switchBranches` : tous les projets en parallèle, chacun : `busy` (lock `Set<string>`, sinon `{ok:false, reason:'busy'}`) → s'il tourne, `pm.stop` → `switchBranch` → si `lockChanged` : `npm install` dans le dépôt (logs dans le projet, stream `'sys'`/`'out'`) → s'il tournait, `pm.start` (même en cas d'échec de bascule, pour ne pas le laisser éteint) → rafraîchir le cache git → `SwitchResult` (`installed`, `restarted`). Ligne `'sys'` dans les logs du projet pour chaque étape.

Routes (corps JSON, erreurs `{ error }` + 400/404) :
- `GET /api/sse` → `DashboardPayload` toutes les 2 s (reprendre le squelette de l'ancien `app/api/sse/route.ts`)
- `POST /api/projects/action` `{ names, action }`
- `GET|PUT /api/projects/[name]/settings` (`PUT { command?, env? }`)
- `POST /api/projects/[name]/reimport`
- `GET /api/projects/[name]/logs?since=N` → `LogLine[]`
- `GET /api/branches?names=a,b` → `string[]`
- `POST /api/branches/switch` `{ names, branch, stash }` → `SwitchResult[]`
- `PUT /api/settings` `{ root }`
- `PUT /api/groups` `{ name, members }`, `DELETE /api/groups?name=`

- [ ] **Step 1: Failing tests** `orchestrator.test.ts` — vrai `ProcessManager` (pidFile tmp), store en mémoire, racine tmp avec dépôts git factices (réutiliser le helper de `git.test.ts`, extrait dans `tests/helpers/repos.ts`) :
  - `refresh imports launch and env for new services only once` (modifier le `.env` après coup ⇒ settings inchangés ; `reimport` ⇒ mis à jour)
  - `new folder cloned later appears on next refresh`
  - `removed folder disappears but its settings are kept`
  - `dashboard reports dbVersion from the database repo`
  - `act start ignores database repos`
  - `updateSettings command sets source manual`
  - `switchBranches restarts a running project after switching`
  - `switchBranches rejects a project already busy` *(Review Focus 5 : deux appels simultanés ⇒ le second renvoie `reason:'busy'`)*
  - `switchBranches continues other projects when one is dirty`
- [ ] **Step 2:** `npx vitest run tests/lib/orchestrator.test.ts` → FAIL
- [ ] **Step 3:** Implémenter la façade, les routes, `instrumentation.ts` (`orchestrator.init()`).
- [ ] **Step 4:** → PASS ; `npx vitest run` → tout PASS ; `npm run build` → OK
- [ ] **Step 5:** `npm run dev`, puis `curl -s http://127.0.0.1:3000/api/sse --max-time 3` → un événement `data:` listant les 8 dépôts Semaphore, `dbVersion: "5.9.1"`. Vérifier que `git -C C:/Repositories/AtoolDev/semaphore/<chaque dépôt> status --porcelain` est identique avant/après. Arrêter le serveur.
- [ ] **Step 6:** `git commit -m "feat: façade orchestrator, API et SSE"`

---

### Task 7: Tableau de bord — liste des projets, sélection, groupes

**Files:** Create `components/ProjectTable.tsx`, `components/Toolbar.tsx`, `components/useDashboard.ts` ; Modify `app/page.tsx`, `app/layout.tsx` (titre « Orchestrator »)

**Interfaces:** Consumes les routes de Task 6. `useDashboard(): { data: DashboardPayload | null; connected: boolean }` (EventSource `/api/sse`, reconnexion auto).

Contenu :
- Une ligne par projet : case à cocher, nom, statut (pastille : vert running, orange restarting, rouge failed, gris stopped), version `package.json`, branche + commit court (+ message en infobulle), badge « N modifiés » (orange) si `dirtyFiles > 0`, badge « N stash » si `stashCount > 0`, ⬆/⬇ ahead/behind, uptime, boutons start/stop/restart, bouton « logs », bouton « config ».
- Si `lastCrash` : sous la ligne, bandeau rouge avec code de sortie et les dernières lignes d'erreur (repliable).
- `database` : affiché à part en en-tête « Base : 5.9.1 (branche) », sans boutons de lancement.
- Barre d'outils : actions sur la sélection (Démarrer / Arrêter / Redémarrer / Changer de branche), groupes enregistrés (clic = sélectionner les membres ; « Enregistrer la sélection comme groupe » ; suppression), champ dossier racine (PUT `/api/settings`), avertissement si `rootExists === false`.
- Projet avec `launch === null` : bouton start désactivé, infobulle « Aucune commande de lancement — configurer ».

- [ ] **Step 1:** Implémenter.
- [ ] **Step 2:** `npx tsc --noEmit` + `npm run lint` → 0 erreur.
- [ ] **Step 3:** Vérification réelle (skill `run`) : `npm run dev`, ouvrir `http://127.0.0.1:3000`, capture : 8 projets, branches `release-candidate`/`staging` affichées, versions (`base 3.16.1`, `stock 2.8.1`…), base 5.9.1. Démarrer un service léger (ex. `navigation-semaphore`), voir passer en running, l'arrêter.
- [ ] **Step 4:** `git commit -m "feat(ui): tableau des projets, sélection et groupes"`

---

### Task 8: Panneau de logs

**Files:** Create `components/LogPanel.tsx` ; Modify `app/page.tsx`

Contenu :
- Panneau ouvrable pour un ou plusieurs projets ; vue fusionnée par horodatage, préfixe coloré par projet, filtre par projet (cases).
- Polling `GET /api/projects/[name]/logs?since=<dernier seq>` toutes les 1 s par projet ouvert ; tampon client 5000 lignes par projet.
- Recherche texte (surlignage + « seulement les lignes correspondantes »), filtre « erreurs seulement » via `isErrorLog`, lignes `'err'` en rouge, `'sys'` en italique.
- Auto-scroll en bas, suspendu si l'utilisateur remonte ; bouton « Effacer » (côté client uniquement).

- [ ] **Step 1:** Implémenter.
- [ ] **Step 2:** `npx tsc --noEmit` + lint.
- [ ] **Step 3:** Vérification réelle : démarrer deux services, ouvrir leurs logs ensemble, rechercher un mot, provoquer un crash (ex. commande éditée en `node -e "process.exit(1)"` via Task 9 ou un service sans base joignable) et vérifier bandeau + lignes `sys` + arrêt après 5 crashs.
- [ ] **Step 4:** `git commit -m "feat(ui): panneau de logs multi-projets"`

---

### Task 9: Éditeur de configuration (commande + variables)

**Files:** Create `components/ConfigDrawer.tsx` ; Modify `app/page.tsx`

Contenu :
- Commande (texte), dossier d'exécution (lecture seule), origine (`IntelliJ : <configName>` / `package.json` / `manuel`).
- Tableau clé/valeur des variables : ajout, suppression, édition ; valeurs dont la clé contient `PASSWORD|SECRET|KEY|TOKEN` masquées par défaut (œil pour afficher).
- « Enregistrer » → `PUT settings` ; message « Redémarrer pour appliquer » + bouton redémarrer si le projet tourne.
- « Réimporter depuis IntelliJ/.env » avec confirmation (« remplace la commande et les variables actuelles »).
- Mention fixe : « Stocké dans Orchestrator — vos dépôts ne sont pas modifiés. »

- [ ] **Step 1:** Implémenter.
- [ ] **Step 2:** `npx tsc --noEmit` + lint.
- [ ] **Step 3:** Vérification réelle : modifier une variable de test, vérifier `data/state.json` modifié et `git -C <dépôt> status --porcelain` inchangé ; réimporter.
- [ ] **Step 4:** `git commit -m "feat(ui): édition de la commande et des variables"`

---

### Task 10: Changement de branche (un ou plusieurs projets)

**Files:** Create `components/BranchDialog.tsx` ; Modify `app/page.tsx`

Contenu :
- Ouvert depuis la sélection (ou le menu d'un projet). Charge `GET /api/branches?names=…`, champ avec autocomplétion.
- Rappel avant validation : projets qui tournent (« seront redémarrés »), projets avec modifs (« seront bloqués »).
- Résultat : récapitulatif par projet — ✅ `<branche>` (+ « npm install lancé », « redémarré »), ⚠️ avec la raison en français (`dirty` « N fichiers modifiés », `branch-not-found` « branche introuvable », `not-fast-forward` « basculé mais pas à jour (commits locaux) », `busy` « opération déjà en cours », `error` + détail).
- Pour les ⚠️ `dirty` : bouton « Stasher et basculer » (relance `switch` avec `stash: true` pour ces projets seulement), avec texte « Vos modifications seront mises de côté (git stash) sur la branche actuelle, pas réappliquées. »

- [ ] **Step 1:** Implémenter.
- [ ] **Step 2:** `npx tsc --noEmit` + lint.
- [ ] **Step 3:** Vérification réelle **sur des clones jetables uniquement** (ne pas faire tourner la bascule sur les dépôts Semaphore de l'utilisateur) : pointer temporairement le dossier racine vers un tmpdir contenant 2 clones de test (helper de `tests/helpers/repos.ts`), dont un modifié ; vérifier récap ✅ / ⚠️, puis « Stasher et basculer ». Remettre le dossier racine.
- [ ] **Step 4:** `git commit -m "feat(ui): changement de branche multi-projets"`

---

### Task 11: README et vérification finale

**Files:** Modify `README.md` (réécrit : but, `npm install`, `npm run dev` / `npm run build && npm start`, dossier racine, import IntelliJ/.env, stockage `data/`, comportement des crashs et du changement de branche) ; supprimer `CLAUDE.md`/`AGENTS.md` ? **Non** — les garder.

- [ ] **Step 1:** Réécrire le README.
- [ ] **Step 2:** `npx vitest run` → PASS ; `npm run lint` ; `npm run build` → OK.
- [ ] **Step 3:** `npm start`, démarrer 2 services, fermer le serveur avec Ctrl+C ⇒ plus aucun `node` enfant (`Get-Process node` avant/après) ; relancer, vérifier `cleanupOrphans` après un `taskkill /F` du serveur.
- [ ] **Step 4:** `git commit -m "docs: README de la refonte"`
