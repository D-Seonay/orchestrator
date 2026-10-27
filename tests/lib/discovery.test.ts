import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanRoot } from '@/lib/discovery';

describe('discovery', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-discovery-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeRepo(name: string, files: Record<string, string> = {}, gitAsFile = false) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    if (gitAsFile) fs.writeFileSync(path.join(dir, '.git'), 'gitdir: elsewhere');
    else fs.mkdirSync(path.join(dir, '.git'));
    for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), content);
    return dir;
  }

  it('detects a service with its package.json version', () => {
    const dir = makeRepo('stock-semaphore', { 'package.json': JSON.stringify({ version: '2.8.1' }) });
    const { rootExists, repos } = scanRoot(root);
    expect(rootExists).toBe(true);
    expect(repos).toEqual([{ name: 'stock-semaphore', path: dir, kind: 'service', version: '2.8.1' }]);
  });

  it('detects the database repo from version.md', () => {
    makeRepo('semaphore-sgbd', { 'version.md': '\n5.9.1\n' });
    expect(scanRoot(root).repos).toMatchObject([{ name: 'semaphore-sgbd', kind: 'database', version: '5.9.1' }]);
  });

  it('ignores folders without .git', () => {
    fs.mkdirSync(path.join(root, 'plain'));
    fs.writeFileSync(path.join(root, 'plain', 'package.json'), '{}');
    expect(scanRoot(root).repos).toEqual([]);
  });

  it('ignores files at root', () => {
    fs.writeFileSync(path.join(root, 'check_images.js'), '');
    expect(scanRoot(root).repos).toEqual([]);
  });

  it('accepts .git as a file', () => {
    makeRepo('wt', { 'package.json': '{}' }, true);
    expect(scanRoot(root).repos).toMatchObject([{ name: 'wt', kind: 'service', version: null }]);
  });

  it('returns rootExists false and no repos for a missing root', () => {
    expect(scanRoot(path.join(root, 'nope'))).toEqual({ rootExists: false, repos: [] });
  });

  it('null version when package.json is invalid JSON', () => {
    makeRepo('broken', { 'package.json': '{oops' });
    expect(scanRoot(root).repos).toMatchObject([{ name: 'broken', kind: 'service', version: null }]);
  });

  it('sorts repos by name', () => {
    makeRepo('b', { 'package.json': '{}' });
    makeRepo('a', { 'package.json': '{}' });
    expect(scanRoot(root).repos.map((r) => r.name)).toEqual(['a', 'b']);
  });
});
