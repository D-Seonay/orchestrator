// Strips ANSI terminal escape sequences (colors, bold, etc.)
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

export function formatUptime(seconds: number): string {
  seconds = Math.floor(seconds);
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  } else if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function parseEnv(content: string): Record<string, string> {
  if (!content) return {};
  const env: Record<string, string> = {};
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index === -1) return;
    const key = trimmed.substring(0, index).trim();
    let value = trimmed.substring(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  });
  return env;
}

/**
 * Distinguishes true error logs from harmless STDERR output such as
 * debug libraries, informational banners, or warning notices.
 */
export function isErrorLog(line: string): boolean {
  const l = line.toLowerCase();

  // 1. Explicitly ignore informational, debug, notice, or warning logs
  if (
    l.includes('debug:') ||
    l.includes('[debug]') ||
    l.includes('info:') ||
    l.includes('[info]') ||
    l.includes('notice:') ||
    l.includes('[notice]') ||
    l.includes('warn:') ||
    l.includes('warning:') ||
    l.includes('[warn]')
  ) {
    return false;
  }

  // 2. Ignore false positives (e.g. "0 errors", "no error", listening banners, git progress on stderr)
  if (
    /0 errors?|no errors?/i.test(l) ||
    l.includes('listening on') ||
    l.includes('local       :') ||
    l.includes('port        :') ||
    l.includes('environment :') ||
    l.includes('cloning into') ||
    l.includes('remote: counting objects') ||
    l.includes('remote: compressing objects')
  ) {
    return false;
  }

  // 3. True error signatures
  return (
    l.includes('error') ||
    l.includes('err_') ||
    l.includes('exception') ||
    l.includes('fatal') ||
    l.includes('crash') ||
    l.includes('failed') ||
    l.includes('failure') ||
    l.includes('eaddrinuse') ||
    l.includes('rejection') ||
    l.includes('uncaught')
  );
}
