# ORCHESTRATOR

Local process manager and dashboard for Node.js applications. Spawn, monitor, and control multiple services from a single unified interface — with a real-time web UI or a lightweight terminal mode.

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square)

---

## Overview

ORCHESTRATOR runs as a Next.js server on your local machine. When the server starts, it reads `apps.config.json` and spawns all configured applications. The dashboard UI connects via Server-Sent Events and receives live status updates every 2 seconds.

Two launch modes:

| Mode | Command | Use case |
|---|---|---|
| **Full dashboard** | `npm start` | Browser UI at `http://localhost:3000` |
| **CLI lightweight** | `npm run cli` | Terminal table, no browser required |

---

## Getting Started

```bash
# Install dependencies
npm install

# Configure your applications (see Configuration section)
# Edit apps.config.json

# Build and start
npm run build
npm start
```

Open `http://localhost:3000`.

---

## Configuration

Edit `apps.config.json` at the project root. Each entry describes one managed process:

```json
[
  {
    "name": "api-server",
    "script": "app.js",
    "args": ["--port", "3000"],
    "cwd": "C:/Repos/my-api",
    "group": "backend",
    "env": {
      "NODE_ENV": "production"
    }
  },
  {
    "name": "front-app",
    "script": "./node_modules/@angular/cli/bin/ng.js",
    "args": "serve front-app",
    "cwd": "C:/Repos/my-frontend",
    "group": "frontend"
  }
]
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✅ | Unique identifier |
| `script` | string | ✅ | Entry point relative to `cwd` |
| `args` | string \| string[] | — | Arguments passed to the script |
| `cwd` | string | — | Working directory (defaults to project root) |
| `group` | string | — | Group name for bulk actions |
| `env` | object | — | Environment variable overrides |

### Environment files

For each app, ORCHESTRATOR looks for a `.env` file in this order:

1. `{cwd}/.env` — if it exists in the app's working directory
2. `.env.{name}` — at the ORCHESTRATOR root (e.g. `.env.api-server`)

These can be viewed and edited directly from the dashboard.

---

## Dashboard Features

### Process Management

- **Start / Stop / Restart** each process individually
- **Bulk group actions** — start, stop, or restart all processes in a group at once
- **Git Pull + Restart** — pulls latest changes from the repo then restarts the process

### Real-time Monitoring

- **Status** — `Online`, `Building`, `Restarting`, `Stopped`, `Crashed`
- **CPU & RAM** usage per process (polled every 5s via PowerShell)
- **Uptime** since last start
- **Restart counter**
- **Git info** — current branch, dirty state (`*`), ahead/behind upstream (`⬆2 ⬇1`)

### Automatic Build Detection

ORCHESTRATOR detects when a process is compiling and switches to `● Building` status automatically, based on stdout patterns:

| Pattern in logs | Status |
|---|---|
| `Building...`, `Rebuilding...`, `Compiling`, `webpack is watching` | **Building** |
| `Compiled successfully`, `ready`, `listening on`, `server started` | **Online** |

Works out of the box with Angular CLI, webpack, and most Node.js frameworks.

### Circuit Breaker

If a process crashes **5 times within 60 seconds**, automatic restarts are suspended and the status switches to `● Crashed`. A banner appears on the card with a **RESET** button. This prevents crash loops from consuming CPU.

Manual `start` or `restart` always bypasses and resets the circuit.

### Log Viewer

Click **LOGS** on any project card to open a fullscreen log viewer:

- ANSI escape codes are stripped automatically
- Color-coded output: errors in red, warnings in yellow, success in green, build in cyan
- **Filter** — search within logs in real-time
- **Errors only** toggle
- **Auto-scroll** — follows new output, pauses on manual scroll, resumes at bottom

### .env File Editor

Click **.env** on any project card to open an in-browser editor:

- Shows the exact file path being edited
- Full textarea for raw `.env` content (supports comments)
- **Save & Restart** — writes the file and restarts the process to apply changes

### Crash Notifications

Browser native notifications (Notification API) fire when a process crashes unexpectedly. Requires one-time permission grant on first visit.

---

## Views & Navigation

### Grid View (default)

Responsive card grid (1 → 2 → 3 columns). Each card shows full details with inline editing.

### List View

Compact one-line-per-project table. Toggle with **≡** in the toolbar. Useful when managing many projects.

### Filter Bar

```
ALL | ONLINE | STOPPED | BUILDING | ERROR
```

Client-side instant filtering. `ERROR` shows projects with recent error lines in logs.

### Search

Press `/` to focus the search input. Filters by project name. Press `Esc` to clear.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `/` | Focus search |
| `↑ / ↓` | Navigate between projects (list view) |
| `R` | Restart focused project |
| `S` | Stop focused project |
| `Esc` | Clear search |

---

## CLI Mode

Runs without the Next.js server or browser. Reads `apps.config.json`, spawns all processes, and renders a live terminal table updated every 2 seconds.

```bash
npm run cli
```

```
🚀 ORCHESTRATOR CLI  | mode léger (sans front)
Uptime: 4m 12s

PROJECT              STATUS       UPTIME      CPU/RAM             GIT           RESTARTS
────────────────────────────────────────────────────────────────────────────────────────────
api-server           Online       4m 10s      0.2%/84.1MB         main                 0
front-app            Building     3m 58s      12.4%/210.3MB       feature/ui           0
────────────────────────────────────────────────────────────────────────────────────────────
Commandes: start/stop/restart [name] | list | git
```

**Stdin commands:**

```bash
restart api-server
stop front-app
start front-app
```

`Ctrl+C` shuts down all managed processes cleanly.

---

## API Reference

All endpoints under `http://localhost:3000/api`.

### SSE stream

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/sse` | Pushes `{ apps: AppStats[], masterUptime: string }` every 2s |

### App management

| Method | Route | Body | Description |
|---|---|---|---|
| `GET` | `/api/apps` | — | List all app configs |
| `POST` | `/api/apps` | `AppConfig` | Add and start a new app |
| `PATCH` | `/api/apps/:name` | `Partial<AppConfig>` | Update config and restart |
| `DELETE` | `/api/apps/:name` | — | Stop and remove |
| `POST` | `/api/apps/:name/action` | `{ action }` | `start` \| `stop` \| `restart` \| `gitpull` |
| `GET` | `/api/apps/:name/envfile` | — | Read `.env` file content |
| `PUT` | `/api/apps/:name/envfile` | `{ content: string }` | Write `.env` file and restart |

### Groups

| Method | Route | Body | Description |
|---|---|---|---|
| `POST` | `/api/groups/:group/action` | `{ action }` | `start` \| `stop` \| `restart` for all apps in group |

---

## Project Structure

```
ORCHESTRATOR/
├── apps.config.json           # App definitions — edit this
├── .env.{name}                # Per-app environment files
│
├── bin/
│   └── cli.ts                 # CLI mode entry point
│
├── lib/
│   ├── orchestrator.ts        # Process manager singleton (globalThis-based)
│   └── utils.ts               # formatUptime, parseEnvFile, stripAnsi
│
├── types/
│   └── index.ts               # AppConfig, AppStats, OrchestratorStatus
│
├── instrumentation.ts         # Next.js hook — init orchestrator on server start
│
├── app/
│   ├── page.tsx               # Dashboard page (SSE consumer, filters, groups)
│   ├── layout.tsx             # Root layout (dark theme, font-mono)
│   └── api/
│       ├── sse/               # GET — live status stream
│       ├── apps/              # CRUD endpoints
│       ├── groups/            # Group action endpoints
│       └── validate-path/     # Live path existence check
│
├── components/
│   ├── ProjectCard.tsx        # Grid view card
│   ├── ProjectRow.tsx         # List view row
│   ├── GroupBar.tsx           # Group header with bulk actions
│   ├── AddProjectModal.tsx    # New project form with live validation
│   ├── LogModal.tsx           # Fullscreen log viewer
│   └── EnvFileModal.tsx       # .env file editor
│
└── tests/
    └── lib/utils.test.ts      # Unit tests
```

---

## Tech Stack

| | |
|---|---|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript 5 |
| **Styling** | Tailwind CSS v4 |
| **Animations** | Framer Motion |
| **Real-time** | Server-Sent Events |
| **Process spawning** | Node.js `child_process` |
| **Tests** | Vitest |
| **CLI runner** | tsx |

---

## Requirements

- **Node.js** 18+
- **Windows** — CPU/RAM monitoring uses PowerShell `Get-Process`
- **Git** — for branch display and git pull features

---

## Scripts

```bash
npm run dev        # Development server (webpack, not Turbopack)
npm run build      # Production build
npm start          # Production server
npm run cli        # Lightweight CLI mode (no browser)
npm test           # Unit tests
npm run test:watch # Tests in watch mode
```
