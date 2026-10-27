import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GitInfo } from './types';

const execFileAsync = promisify(execFile);

interface GitResult { ok: boolean; stdout: string; stderr: string; }

async function git(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: e.stdout ?? '', stderr: (e.stderr || e.message || '').trim() };
  }
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

export async function switchBranch(
  cwd: string,
  branch: string,
  opts: { stash: boolean },
): Promise<SwitchBranchResult> {
  const notes: string[] = [];
  const fail = (reason: NonNullable<SwitchBranchResult['reason']>, detail: string, lockChanged = false): SwitchBranchResult => ({
    ok: false,
    reason,
    detail: [detail, ...notes].filter(Boolean).join(' — '),
    lockChanged,
  });

  // 1. Arbre sale : refus, ou mise de côté explicite (jamais réappliquée).
  const dirty = await countDirtyFiles(cwd);
  if (dirty > 0) {
    if (!opts.stash) return fail('dirty', `${dirty} fichiers modifiés`);
    const stashed = await git(cwd, ['stash', 'push', '-m', `orchestrator: avant bascule vers ${branch}`]);
    if (!stashed.ok) return fail('error', `stash impossible : ${stashed.stderr}`);
  }

  // 2. Fetch : un échec (hors ligne) est toléré.
  const fetched = await git(cwd, ['fetch', 'origin', '--prune']);
  if (!fetched.ok) notes.push('fetch origin impossible (hors ligne ?)');

  // 3. La branche doit exister en local ou sur origin.
  const isLocal = (await git(cwd, ['show-ref', '--verify', '--quiet', `${LOCAL_PREFIX}${branch}`])).ok;
  const isRemote = (await git(cwd, ['show-ref', '--verify', '--quiet', `${REMOTE_PREFIX}${branch}`])).ok;
  if (!isLocal && !isRemote) return fail('branch-not-found', `branche ${branch} introuvable`);

  // 4-5. Bascule, en mémorisant le blob de package-lock.json avant.
  const lockBefore = await lockBlob(cwd);
  const checkout = isLocal
    ? await git(cwd, ['checkout', branch])
    : await git(cwd, ['checkout', '-b', branch, '--track', `origin/${branch}`]);
  if (!checkout.ok) return fail('error', checkout.stderr);

  const lockChanged = async () => lockBefore !== (await lockBlob(cwd));

  // 6. Mise à jour en fast-forward uniquement. Hors ligne, on avance sur la référence déjà récupérée.
  if (await hasUpstream(cwd)) {
    const update = fetched.ok ? await git(cwd, ['pull', '--ff-only']) : await git(cwd, ['merge', '--ff-only', '@{u}']);
    if (!update.ok) return fail('not-fast-forward', `basculé sur ${branch} mais pas à jour`, await lockChanged());
  }

  // 7.
  return { ok: true, detail: notes.join(' — ') || undefined, lockChanged: await lockChanged() };
}
