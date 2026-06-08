export interface AppConfig {
  name: string;
  script: string;
  args?: string | string[];
  cwd?: string;
  env?: Record<string, string>;
  group?: string;
}

export interface AppStats extends AppConfig {
  status: 'Online' | 'Stopped' | 'Restarting' | 'Building' | 'Crashed';
  restarts: number;
  uptime: string;
  cpu: string;
  ram: string;
  git: {
    branch: string;
    dirty: boolean;
    sync: string;
  };
  shouldRun: boolean;
  logs: string[];
}

export interface OrchestratorStatus {
  apps: AppStats[];
  masterUptime: string;
}
