# Orchestrator Pro Dashboard V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the Node.js orchestrator with a Brutalist Dark Mode dashboard, hour-formatted uptime, and dynamic project management.

**Architecture:** A React frontend (Vite) communicating with a Node.js backend that persists configuration in JSON. The backend serves the production build of the frontend.

**Tech Stack:** Node.js, React, Vite, Framer Motion, Vanilla CSS.

---

### Task 1: Transition to JSON Configuration

**Files:**
- Create: `apps.config.json`
- Modify: `orchestrator.js`

- [ ] **Step 1: Create the JSON config file**
Create `apps.config.json` with existing data from `apps.config.js`.

```json
[
  {
    "name": "front-semaphore",
    "script": "./node_modules/@angular/cli/bin/ng.js",
    "args": "serve front-semaphore",
    "cwd": "C:/Repositories/AtoolDev/semaphore/front-semaphore"
  },
  {
    "name": "base-semaphore",
    "script": "app.js",
    "cwd": "C:/Repositories/AtoolDev/semaphore/base-semaphore"
  },
  {
    "name": "purchase-semaphore",
    "script": "app.js",
    "cwd": "C:/Repositories/AtoolDev/semaphore/purchase-semaphore"
  },
  {
    "name": "stock-semaphore",
    "script": "app.js",
    "cwd": "C:/Repositories/AtoolDev/semaphore/stock-semaphore"
  }
]
```

- [ ] **Step 2: Update orchestrator to load JSON**
Modify `orchestrator.js` to require `apps.config.json` instead of `.js`.

- [ ] **Step 3: Verify orchestrator still starts**
Run: `node orchestrator.js`
Expected: Dashboard CLI shows 4 apps online.

- [ ] **Step 4: Commit**
```bash
git add apps.config.json orchestrator.js
git commit -m "chore: migrate config to JSON"
```

---

### Task 2: Implement Uptime Hour Formatting

**Files:**
- Modify: `orchestrator.js`

- [ ] **Step 1: Update getAppStats uptime logic**
Modify the `getAppStats` function in `orchestrator.js` to handle hours.

```javascript
// Inside getAppStats
const uptime = isOnline && procState.startTime ? Math.floor((Date.now() - procState.startTime) / 1000) : 0;
let uptimeStr;
if (uptime >= 3600) {
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const s = uptime % 60;
  uptimeStr = `${h}h ${m}m ${s}s`;
} else if (uptime >= 60) {
  uptimeStr = `${Math.floor(uptime/60)}m ${uptime%60}s`;
} else {
  uptimeStr = `${uptime}s`;
}
```

- [ ] **Step 2: Verify CLI display**
Run: `node orchestrator.js`
Wait for an app to reach 1 minute, then verify format.

- [ ] **Step 3: Commit**
```bash
git commit -am "feat: add hour formatting to uptime"
```

---

### Task 3: Backend API for Project Management

**Files:**
- Modify: `orchestrator.js`

- [ ] **Step 1: Add POST /api/apps (Add Project)**
Implement logic to append to `apps.config.json` and start the new process.

- [ ] **Step 2: Add PATCH /api/apps/:name (Update Values)**
Implement logic to update launch values and restart the app.

- [ ] **Step 3: Add DELETE /api/apps/:name (Remove Project)**
Implement logic to stop the app and remove it from JSON.

- [ ] **Step 4: Commit**
```bash
git commit -am "feat: add project management API endpoints"
```

---

### Task 4: Initialize Vite Frontend

**Files:**
- Create: `dashboard/`

- [ ] **Step 1: Scaffold Vite app**
Run: `npm create vite@latest dashboard -- --template react`

- [ ] **Step 2: Install dependencies**
Run: `cd dashboard && npm install framer-motion`

- [ ] **Step 3: Commit**
```bash
git add dashboard/
git commit -m "chore: initialize dashboard react app"
```

---

### Task 5: Brutalist UI Components

**Files:**
- Create: `dashboard/src/App.css`
- Create: `dashboard/src/App.jsx`

- [ ] **Step 1: Implement Dark Mode Absolute styles**
Apply the Deep Zinc/Silver-white styles from the mockup.

- [ ] **Step 2: Create ProjectCard with Framer Motion**
Implement smooth fades and status transitions.

- [ ] **Step 3: Commit**
```bash
git commit -am "feat: implement brutalist UI components"
```

---

### Task 6: Project Management UI

**Files:**
- Create: `dashboard/src/components/AddProjectModal.jsx`
- Modify: `dashboard/src/App.jsx`

- [ ] **Step 1: Implement Add Project Modal**
- [ ] **Step 2: Implement Inline Editing for launch values**
- [ ] **Step 3: Commit**
```bash
git commit -am "feat: add project management UI features"
```

---

### Task 7: Final Integration

**Files:**
- Modify: `orchestrator.js`

- [ ] **Step 1: Serve built frontend from orchestrator**
- [ ] **Step 2: Final end-to-end verification**
- [ ] **Step 3: Commit**
```bash
git commit -am "feat: integrate frontend with orchestrator"
```
