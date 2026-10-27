import { execFile } from 'child_process';
import { childEnv } from './child-env';
import { formatDuration, killTreeAsync } from './kill-tree';
import type { GitInfo } from './types';

/** Délai maximal d'une opération réseau (fetch, pull) avant d'interrompre git et ses sous-process. */
export const NETWORK_TIMEOUT_MS = 60_000;

interface GitResult { ok: boolean; stdout: string; stderr: string; timedOut?: boolean; }

function git(cwd: string, args: string[], timeoutMs?: number): Promise<GitResult> {
  return new Promise((resolve) => {
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const child = execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        // Environnement nettoyé (des hooks peuvent lancer node) ; le status interrogé en boucle ne prend pas index.lock.
        env: childEnv({ GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }),
      },
      (err, stdout, stderr) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ ok: false, stdout, stderr: `git ${args[0]} interrompu après ${formatDuration(timeoutMs!)}`, timedOut: true });
        } else if (!err) {
          resolve({ ok: true, stdout, stderr });
        } else {
          resolve({ ok: false, stdout: stdout ?? '', stderr: (stderr || err.message || '').trim() });
        }
      },
    );
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        killTreeAsync(child.pid); // avec ses helpers (git-remote-https, ssh…)
      }, timeoutMs);
    }
  });
}

function lines(output: string): string[] {
  return output.split(/\r?\n/).filter((l) => l.length > 0);
}

async function currentBranch(cwd: string): Promise<string> {
  const r = await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : 'HEAD';
}

async function countDirtyFiles(cwd: string): Promise<number> {
  const r = await git(cwd, ['status', '--porcelain', '--untracked-files=no']);
  return lines(r.stdout).length;
}

async function hasUpstream(cwd: string): Promise<boolean> {
  return (await git(cwd, ['rev-parse', '--abbrev-ref', '@{u}'])).ok;
}

async function lockBlob(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', 'HEAD:package-lock.json']);
  return r.ok ? r.stdout.trim() : null;
}

export async function getGitInfo(cwd: string): Promise<GitInfo | null> {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') return null;

  const [branch, log, dirtyFiles, stash, counts] = await Promise.all([
    currentBranch(cwd),
    git(cwd, ['log', '-1', '--format=%h%x00%s']),
    countDirtyFiles(cwd),
    git(cwd, ['stash', 'list']),
    git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']),
  ]);

  const [commit = '', message = ''] = log.ok ? log.stdout.trim().split('\0') : [];
  const [ahead = 0, behind = 0] = counts.ok ? counts.stdout.trim().split(/\s+/).map(Number) : [];

  return { branch, commit, message, dirtyFiles, stashCount: lines(stash.stdout).length, ahead, behind };
}

const LOCAL_PREFIX = 'refs/heads/';
const REMOTE_PREFIX = 'refs/remotes/origin/';

export async function listBranches(cwd: string): Promise<string[]> {
  const r = await git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes/origin']);
  const names = new Set<string>();
  for (const ref of lines(r.stdout)) {
    const name = ref.startsWith(LOCAL_PREFIX) ? ref.slice(LOCAL_PREFIX.length) : ref.slice(REMOTE_PREFIX.length);
    if (name && name !== 'HEAD') names.add(name);
  }
  return [...names].sort();
}

export interface SwitchBranchResult {
  ok: boolean;
  reason?: 'dirty' | 'branch-not-found' | 'not-fast-forward' | 'error';
  detail?: string;
  lockChanged: boolean;
}

export interface SwitchOptions {
  stash: boolean;
  /** Délai des opérations réseau (défaut NETWORK_TIMEOUT_MS). */
  timeoutMs?: number;
}

/** Résultat d'une pré-vérification réussie : de quoi appliquer la bascule sans refaire les contrôles réseau. */
export interface SwitchPlan {
  branch: string;
  isLocal: boolean;
  fetched: boolean;
  notes: string[];
}

export type SwitchCheck = { ok: true; plan: SwitchPlan } | { ok: false; result: SwitchBranchResult };

const failure = (
  reason: NonNullable<SwitchBranchResult['reason']>,
  detail: string,
  notes: string[],
  lockChanged = false,
): SwitchBranchResult => ({ ok: false, reason, detail: [detail, ...notes].filter(Boolean).join(' — '), lockChanged });

/**
 * Pré-vérification sans effet sur l'arbre de travail : refus si modifs non commitées (sans stash demandé),
 * fetch (un échec, hors ligne, est toléré), puis la branche doit exister en local ou sur origin.
 */
export async function checkSwitch(cwd: string, branch: string, opts: SwitchOptions): Promise<SwitchCheck> {
  const notes: string[] = [];

  // 1. Arbre sale : refus, sauf mise de côté explicite (faite à l'application).
  if (!opts.stash) {
    const dirty = await countDirtyFiles(cwd);
    if (dirty > 0) return { ok: false, result: failure('dirty', `${dirty} fichiers modifiés`, notes) };
  }

  // 2. Fetch.
  const fetched = await git(cwd, ['fetch', 'origin', '--prune'], opts.timeoutMs ?? NETWORK_TIMEOUT_MS);
  if (fetched.timedOut) notes.push(`${fetched.stderr} (origin injoignable ?)`);
  else if (!fetched.ok) notes.push('fetch origin impossible (hors ligne ?)');

  // 3. La branche doit exister en local ou sur origin.
  const isLocal = (await git(cwd, ['show-ref', '--verify', '--quiet', `${LOCAL_PREFIX}${branch}`])).ok;
  const isRemote = (await git(cwd, ['show-ref', '--verify', '--quiet', `${REMOTE_PREFIX}${branch}`])).ok;
  if (!isLocal && !isRemote) return { ok: false, result: failure('branch-not-found', `branche ${branch} introuvable`, notes) };

  return { ok: true, plan: { branch, isLocal, fetched: fetched.ok, notes } };
}

/** Application d'une bascule pré-vérifiée : stash éventuel (jamais réappliqué), checkout, pull --ff-only, comparaison du lock. */
export async function applySwitch(cwd: string, plan: SwitchPlan, opts: SwitchOptions): Promise<SwitchBranchResult> {
  const { branch, isLocal, notes } = plan;

  // 4. L'arbre a pu changer depuis la pré-vérification : on recontrôle avant d'y toucher.
  const dirty = await countDirtyFiles(cwd);
  if (dirty > 0) {
    if (!opts.stash) return failure('dirty', `${dirty} fichiers modifiés`, notes);
    const stashed = await git(cwd, ['stash', 'push', '-m', `orchestrator: avant bascule vers ${branch}`]);
    if (!stashed.ok) return failure('error', `stash impossible : ${stashed.stderr}`, notes);
  }

  // 5-6. Bascule, en mémorisant le blob de package-lock.json avant.
  const lockBefore = await lockBlob(cwd);
  const checkout = isLocal
    ? await git(cwd, ['checkout', branch])
    : await git(cwd, ['checkout', '-b', branch, '--track', `origin/${branch}`]);
  if (!checkout.ok) return failure('error', checkout.stderr, notes);

  const lockChanged = async () => lockBefore !== (await lockBlob(cwd));

  // 7. Mise à jour en fast-forward uniquement. Hors ligne, on avance sur la référence déjà récupérée.
  if (await hasUpstream(cwd)) {
    const update = plan.fetched
      ? await git(cwd, ['pull', '--ff-only'], opts.timeoutMs ?? NETWORK_TIMEOUT_MS)
      : await git(cwd, ['merge', '--ff-only', '@{u}']);
    if (update.timedOut) return failure('error', `basculé sur ${branch} mais ${update.stderr}`, notes, await lockChanged());
    if (!update.ok) return failure('not-fast-forward', `basculé sur ${branch} mais pas à jour`, notes, await lockChanged());
  }

  // 8.
  return { ok: true, detail: notes.join(' — ') || undefined, lockChanged: await lockChanged() };
}

/** Pré-vérification puis application. */
export async function switchBranch(cwd: string, branch: string, opts: SwitchOptions): Promise<SwitchBranchResult> {
  const check = await checkSwitch(cwd, branch, opts);
  return check.ok ? applySwitch(cwd, check.plan, opts) : check.result;
}
