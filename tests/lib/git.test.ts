import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applySwitch, checkSwitch, getGitInfo, listBranches, switchBranch } from '@/lib/git';
import { cloneRepo, commitFile, createRepoPair, git, push, writeFile, type RepoPair } from '../helpers/repos';

describe('git', () => {
  let pair: RepoPair;

  beforeEach(() => {
    pair = createRepoPair();
  }, 30_000);

  afterEach(() => {
    pair.cleanup();
  });

  /** Second clone, pour publier des commits sur origin comme le ferait un collègue. */
  function colleague() {
    return cloneRepo(pair.origin, path.join(pair.base, 'colleague'));
  }

  describe('getGitInfo', () => {
    it('reports branch, short commit, message', async () => {
      const info = await getGitInfo(pair.work);
      expect(info).toEqual({
        branch: 'main',
        commit: git(pair.work, 'rev-parse', '--short', 'HEAD'),
        message: 'initial commit',
        dirtyFiles: 0,
        stashCount: 0,
        ahead: 0,
        behind: 0,
      });
    }, 30_000);

    it('counts dirty tracked files and ignores untracked', async () => {
      writeFile(pair.work, 'a.txt', 'changed\n');
      writeFile(pair.work, 'package-lock.json', 'changed\n');
      writeFile(pair.work, 'untracked.txt', 'new\n');
      expect((await getGitInfo(pair.work))?.dirtyFiles).toBe(2);
    }, 30_000);

    it('counts stashes and ahead/behind against upstream', async () => {
      writeFile(pair.work, 'a.txt', 'stash me\n');
      git(pair.work, 'stash', 'push', '-m', 'x');
      commitFile(pair.work, 'local.txt', 'l\n');
      const other = colleague();
      commitFile(other, 'remote.txt', 'r\n');
      commitFile(other, 'remote2.txt', 'r\n');
      push(other, 'origin', 'main');
      git(pair.work, 'fetch', 'origin');
      const info = await getGitInfo(pair.work);
      expect(info).toMatchObject({ stashCount: 1, ahead: 1, behind: 2 });
    }, 30_000);

    it('returns null outside a repo', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-norepo-'));
      try {
        expect(await getGitInfo(dir)).toBeNull();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 30_000);
  });

  describe('listBranches', () => {
    it('merges local and origin branches', async () => {
      git(pair.work, 'branch', 'local-only');
      const other = colleague();
      git(other, 'checkout', '-b', 'feature/remote');
      commitFile(other, 'f.txt', 'f\n');
      push(other, '-u', 'origin', 'feature/remote');
      git(pair.work, 'fetch', 'origin');

      expect(await listBranches(pair.work)).toEqual(['feature/remote', 'local-only', 'main', 'staging']);
    }, 30_000);
  });

  describe('switchBranch', () => {
    it('refuses when dirty and touches nothing', async () => {
      writeFile(pair.work, 'a.txt', 'changed\n');
      const result = await switchBranch(pair.work, 'staging', { stash: false });
      expect(result).toEqual({ ok: false, reason: 'dirty', detail: '1 fichiers modifiés', lockChanged: false });
      expect(fs.readFileSync(path.join(pair.work, 'a.txt'), 'utf8')).toBe('changed\n');
      const info = await getGitInfo(pair.work);
      expect(info).toMatchObject({ branch: 'main', dirtyFiles: 1, stashCount: 0 });
    }, 30_000);

    it('with stash parks changes and does not pop them', async () => {
      writeFile(pair.work, 'a.txt', 'changed\n');
      const result = await switchBranch(pair.work, 'staging', { stash: true });
      expect(result.ok).toBe(true);
      const info = await getGitInfo(pair.work);
      expect(info).toMatchObject({ branch: 'staging', dirtyFiles: 0, stashCount: 1 });
      expect(git(pair.work, 'stash', 'list')).toContain('orchestrator: avant bascule vers staging');
    }, 30_000);

    it('checks out a branch that only exists on origin', async () => {
      const other = colleague();
      git(other, 'checkout', '-b', 'feature/remote');
      commitFile(other, 'f.txt', 'f\n');
      push(other, '-u', 'origin', 'feature/remote');

      const result = await switchBranch(pair.work, 'feature/remote', { stash: false });
      expect(result.ok).toBe(true);
      expect(fs.existsSync(path.join(pair.work, 'f.txt'))).toBe(true);
      expect(git(pair.work, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/feature/remote');
    }, 30_000);

    it('reports branch-not-found', async () => {
      const result = await switchBranch(pair.work, 'nope', { stash: false });
      expect(result).toMatchObject({ ok: false, reason: 'branch-not-found', lockChanged: false });
      expect((await getGitInfo(pair.work))?.branch).toBe('main');
    }, 30_000);

    it('does not stash when the branch is not found (pre-check before stashing)', async () => {
      writeFile(pair.work, 'a.txt', 'changed\n');
      const result = await switchBranch(pair.work, 'nope', { stash: true });
      expect(result).toMatchObject({ ok: false, reason: 'branch-not-found' });
      expect(await getGitInfo(pair.work)).toMatchObject({ branch: 'main', dirtyFiles: 1, stashCount: 0 });
      expect(fs.readFileSync(path.join(pair.work, 'a.txt'), 'utf8')).toBe('changed\n');
    }, 30_000);

    it('checkSwitch touches nothing, even with stash on a dirty tree', async () => {
      writeFile(pair.work, 'a.txt', 'changed\n');
      const check = await checkSwitch(pair.work, 'staging', { stash: true });
      expect(check).toMatchObject({ ok: true, plan: { branch: 'staging', isLocal: true, fetched: true } });
      expect(await getGitInfo(pair.work)).toMatchObject({ branch: 'main', dirtyFiles: 1, stashCount: 0 });

      expect(await checkSwitch(pair.work, 'staging', { stash: false })).toMatchObject({ ok: false, result: { reason: 'dirty' } });
    }, 30_000);

    it('applySwitch re-checks a tree that became dirty after the pre-check', async () => {
      const check = await checkSwitch(pair.work, 'staging', { stash: false });
      if (!check.ok) throw new Error('pre-check failed');
      writeFile(pair.work, 'a.txt', 'changed\n');
      expect(await applySwitch(pair.work, check.plan, { stash: false })).toMatchObject({ ok: false, reason: 'dirty' });
      expect((await getGitInfo(pair.work))?.branch).toBe('main');
    }, 30_000);

    it('reports not-fast-forward when local branch diverged', async () => {
      git(pair.work, 'checkout', 'staging');
      commitFile(pair.work, 'local.txt', 'local\n');
      git(pair.work, 'checkout', 'main');

      const other = colleague();
      git(other, 'checkout', 'staging');
      commitFile(other, 'remote.txt', 'remote\n');
      push(other, 'origin', 'staging');

      const result = await switchBranch(pair.work, 'staging', { stash: false });
      expect(result).toMatchObject({
        ok: false,
        reason: 'not-fast-forward',
        detail: 'basculé sur staging mais pas à jour',
      });
      expect((await getGitInfo(pair.work))?.branch).toBe('staging');
    }, 30_000);

    it('fast-forwards a behind branch', async () => {
      const other = colleague();
      git(other, 'checkout', 'staging');
      commitFile(other, 'remote.txt', 'remote\n');
      push(other, 'origin', 'staging');

      const result = await switchBranch(pair.work, 'staging', { stash: false });
      expect(result.ok).toBe(true);
      expect(fs.existsSync(path.join(pair.work, 'remote.txt'))).toBe(true);
    }, 30_000);

    it('tolerates an unreachable origin and says so', async () => {
      git(pair.work, 'remote', 'set-url', 'origin', path.join(pair.base, 'missing.git'));
      const result = await switchBranch(pair.work, 'staging', { stash: false });
      expect(result.ok).toBe(true);
      expect(result.detail).toContain('fetch');
      expect((await getGitInfo(pair.work))?.branch).toBe('staging');
    }, 30_000);

    it('sets lockChanged only when package-lock.json differs', async () => {
      const same = await switchBranch(pair.work, 'staging', { stash: false });
      expect(same).toMatchObject({ ok: true, lockChanged: false });

      commitFile(pair.work, 'package-lock.json', '{"lockfileVersion":3,"changed":true}\n');
      push(pair.work, 'origin', 'staging');

      const differs = await switchBranch(pair.work, 'main', { stash: false });
      expect(differs).toMatchObject({ ok: true, lockChanged: true });

      const back = await switchBranch(pair.work, 'staging', { stash: false });
      expect(back).toMatchObject({ ok: true, lockChanged: true });
    }, 30_000);
  });
});
