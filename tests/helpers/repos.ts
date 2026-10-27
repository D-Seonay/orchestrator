import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function configureRepo(dir: string) {
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

export function writeFile(repo: string, file: string, content: string) {
  fs.writeFileSync(path.join(repo, file), content);
}

/** Écrit un fichier puis le commit ; retourne le hash complet du commit. */
export function commitFile(repo: string, file: string, content: string, message = `update ${file}`): string {
  writeFile(repo, file, content);
  git(repo, 'add', file);
  git(repo, 'commit', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

export function push(repo: string, ...args: string[]) {
  git(repo, 'push', ...args);
}

/** Clone `origin` dans `dir` avec la config locale de test. */
export function cloneRepo(origin: string, dir: string): string {
  git(path.dirname(dir), 'clone', '--quiet', origin, dir);
  configureRepo(dir);
  return dir;
}

export interface RepoPair {
  /** Dépôt bare servant d'origin. */
  origin: string;
  /** Clone de travail, sur `main` (suivi origin/main). */
  work: string;
  /** Dossier temporaire parent, pour y créer d'autres clones. */
  base: string;
  cleanup: () => void;
}

/**
 * Crée en tmpdir un dépôt bare `origin` et un clone `work`.
 * `main` : a.txt + package-lock.json ; `staging` : un commit de plus (staging.txt). Les deux sont poussées.
 */
export function createRepoPair(opts: { lock?: string } = {}): RepoPair {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-git-'));
  const origin = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  fs.mkdirSync(origin);
  fs.mkdirSync(work);
  git(origin, 'init', '--bare', '-b', 'main');
  git(work, 'init', '-b', 'main');
  configureRepo(work);
  git(work, 'remote', 'add', 'origin', origin);

  writeFile(work, 'package-lock.json', opts.lock ?? '{"lockfileVersion":3}\n');
  git(work, 'add', 'package-lock.json');
  commitFile(work, 'a.txt', 'a\n', 'initial commit');
  push(work, '-u', 'origin', 'main');

  git(work, 'checkout', '-b', 'staging');
  commitFile(work, 'staging.txt', 'staging\n', 'staging commit');
  push(work, '-u', 'origin', 'staging');
  git(work, 'checkout', 'main');

  return { origin, work, base, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
