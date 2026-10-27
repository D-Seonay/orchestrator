import fs from 'fs';
import path from 'path';
import { parseRunConfigs } from './intellij';
import { parseEnv } from './utils';
import type { LaunchSpec, RunConfig } from './types';

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readWorkspace(repoPath: string): { selected: string | null; configs: RunConfig[] } {
  const xml = readText(path.join(repoPath, '.idea', 'workspace.xml'));
  if (xml === null) return { selected: null, configs: [] };
  try {
    return parseRunConfigs(xml, repoPath);
  } catch {
    return { selected: null, configs: [] };
  }
}

function hasStartScript(repoPath: string): boolean {
  const content = readText(path.join(repoPath, 'package.json'));
  if (content === null) return false;
  try {
    return typeof JSON.parse(content)?.scripts?.start === 'string';
  } catch {
    return false;
  }
}

export function listRunConfigs(repoPath: string): RunConfig[] {
  return readWorkspace(repoPath).configs;
}

export function detectLaunch(
  repoPath: string,
  configKey?: string,
): { launch: LaunchSpec | null; env: Record<string, string> } {
  const { selected, configs } = readWorkspace(repoPath);
  const chosen =
    (configKey !== undefined ? configs.find((c) => c.key === configKey) : undefined) ??
    configs.find((c) => c.key === selected) ??
    configs.find((c) => !c.temporary) ??
    configs[0];

  let launch: LaunchSpec | null = null;
  if (chosen) {
    launch = { command: chosen.command, cwd: chosen.cwd, source: 'intellij', configName: chosen.name };
  } else if (hasStartScript(repoPath)) {
    launch = { command: 'npm start', cwd: repoPath, source: 'package.json' };
  }

  const dotenv = readText(path.join(repoPath, '.env'));
  const env = { ...(chosen?.env ?? {}), ...(dotenv !== null ? parseEnv(dotenv) : {}) };
  return { launch, env };
}
