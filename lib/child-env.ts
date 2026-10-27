// Environnement des process lancés par l'Orchestrator (services, npm install).
// Next pose dans son propre process des variables qui ne concernent que lui : les transmettre
// casserait les services (NODE_ENV=production ⇒ npm install sans devDependencies, PORT=3000, …).

const IS_WINDOWS = process.platform === 'win32';

/** Variable par laquelle le watchdog reçoit le NODE_OPTIONS du service, qu'il ne doit pas appliquer à lui-même. */
export const CHILD_NODE_OPTIONS = 'ORCH_CHILD_NODE_OPTIONS';

const DROPPED = new Set(['NODE_ENV', 'PORT', 'NODE_OPTIONS', CHILD_NODE_OPTIONS]);
const DROPPED_PREFIX = /^(__NEXT|NEXT_|TURBOPACK)/i;

const isDropped = (key: string) => DROPPED.has(key.toUpperCase()) || DROPPED_PREFIX.test(key);

/**
 * Environnement d'Orchestrator sans les variables propres à Next, complété par `extra`
 * (les variables du projet, qui l'emportent — y compris NODE_ENV, PORT ou NODE_OPTIONS si le projet les définit).
 */
function build(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !isDropped(key)) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    // Windows : les noms sont insensibles à la casse ; on évite deux entrées « Path » / « PATH ».
    if (IS_WINDOWS) {
      for (const existing of Object.keys(env)) {
        if (existing !== key && existing.toUpperCase() === key.toUpperCase()) delete env[existing];
      }
    }
    env[key] = value;
  }
  return env;
}

// Le type ProcessEnv de Next exige NODE_ENV, que l'on retire justement : d'où les conversions.
export const childEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => build(extra) as NodeJS.ProcessEnv;

/**
 * Environnement du watchdog d'un service : celui du service, mais son NODE_OPTIONS voyage dans
 * CHILD_NODE_OPTIONS (le watchdog est lui-même un process node et ne doit pas en hériter).
 */
export function watchdogEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env = build(extra);
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'NODE_OPTIONS') {
      env[CHILD_NODE_OPTIONS] = env[key];
      delete env[key];
    }
  }
  return env as NodeJS.ProcessEnv;
}
