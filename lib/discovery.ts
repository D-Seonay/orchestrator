import fs from 'fs';
import path from 'path';
import type { DiscoveredRepo } from './types';

function readPackageVersion(file: string): string | null {
  try {
    const version = JSON.parse(fs.readFileSync(file, 'utf8'))?.version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

function readVersionMd(file: string): string | null {
  try {
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '');
    return line ?? null;
  } catch {
    return null;
  }
}

export function scanRoot(root: string): { rootExists: boolean; repos: DiscoveredRepo[] } {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { rootExists: false, repos: [] };
  }

  const repos: DiscoveredRepo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    if (!fs.existsSync(path.join(dir, '.git'))) continue;

    const pkg = path.join(dir, 'package.json');
    const versionMd = path.join(dir, 'version.md');
    if (fs.existsSync(pkg)) {
      repos.push({ name: entry.name, path: dir, kind: 'service', version: readPackageVersion(pkg) });
    } else if (fs.existsSync(versionMd)) {
      repos.push({ name: entry.name, path: dir, kind: 'database', version: readVersionMd(versionMd) });
    }
  }
  return { rootExists: true, repos: repos.sort((a, b) => a.name.localeCompare(b.name)) };
}
