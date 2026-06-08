# Design Spec - Orchestrator Pro Dashboard V2

## 1. Overview
The goal is to modernize the existing Node.js orchestrator with a "Dark Mode Absolute" dashboard built using React, Framer Motion, and Vanilla CSS. The dashboard will support adding new projects and modifying existing launch configurations directly from the UI, with persistent storage in a JSON configuration file.

## 2. Visual Design (Dark Mode Absolute)
- **Palette:** 
  - Background: `#09090b` (Deep Zinc)
  - Typography: `#fafafa` (Silver-white)
  - Accents: `#71717a` (Zinc-400) for technical monospace text.
- **Typography:**
  - Headers: Brutalist style (Inter Black, uppercase, tight letter-spacing).
  - Accents: Monospace (Fira Code) for technical data (CPU, RAM, Uptime).
- **Motion:** "Stealth" animations using Framer Motion (slow fades, subtle transforms).
- **Layout:** Extreme whitespace to create a "digital gallery" feel, emphasizing clarity and focus.

## 3. Technical Architecture

### 3.1 Frontend (React + Vite)
- **Framework:** React 18+
- **Styling:** Vanilla CSS (no Tailwind).
- **Animations:** Framer Motion.
- **State Management:** React Context or simple Hooks for application state.
- **Networking:** Fetch API to communicate with the Orchestrator backend.

### 3.2 Backend (Node.js Orchestrator)
- **Configuration:** Transition from `apps.config.js` to `apps.config.json`.
- **API Endpoints:**
  - `GET /api/status`: Returns real-time status, stats, and git info for all apps.
  - `POST /api/apps`: Adds a new application configuration.
  - `PATCH /api/apps/:name`: Updates launch values (script, args, env, cwd) for a specific app.
  - `DELETE /api/apps/:name`: Removes an app configuration.
  - `POST /api/action`: Control actions (start, stop, restart).

### 3.3 Data Model (`apps.config.json`)
```json
[
  {
    "name": "front-semaphore",
    "script": "./node_modules/@angular/cli/bin/ng.js",
    "args": "serve front-semaphore",
    "cwd": "C:/Repositories/AtoolDev/semaphore/front-semaphore",
    "env": {}
  }
]
```

## 4. Key Features

### 4.1 "Stealth" Monitoring
- Real-time CPU/RAM updates with smooth numerical transitions.
- Uptime formatting logic: 
  - < 60min: `XXm YYs`
  - \>= 60min: `Xh Ym Zs`
- Git status indicators (branch, dirty state, sync status).

### 4.2 Dynamic Configuration
- **Add Project Modal:** A minimalist form to register new services.
- **Inline Editing:** Click-to-edit for launch arguments and script paths.
- **Persistence:** All changes are immediately written to `apps.config.json` and the orchestrator handles process reloading.

## 5. Success Criteria
- [ ] Dashboard renders correctly with the Dark Mode Absolute aesthetic.
- [ ] New projects can be added and started without manual file edits.
- [ ] Launch values (args, script) can be updated from the UI.
- [ ] Uptime correctly switches to hour format after 60 minutes.
- [ ] Zero build overhead for the user when running in "production" mode (bundled app).
