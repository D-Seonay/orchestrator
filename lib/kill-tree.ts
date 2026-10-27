import { execFile } from 'child_process';

const IS_WINDOWS = process.platform === 'win32';

/**
 * Tue un process et ses descendants, sans attendre (Windows : `taskkill /T /F`).
 * POSIX : le process doit avoir été lancé `detached` pour être chef de groupe, sinon seul lui est tué.
 */
export function killTreeAsync(pid: number | undefined): void {
  if (!pid || pid <= 0) return;
  if (IS_WINDOWS) {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => { /* déjà parti */ });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* déjà parti */ }
  }
}

/** « 60 s », « 10 min ». */
export function formatDuration(ms: number): string {
  return ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Number((ms / 1000).toFixed(1))} s`;
}
