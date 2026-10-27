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
