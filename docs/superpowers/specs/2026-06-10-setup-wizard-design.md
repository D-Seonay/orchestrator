# Design Spec: Managed Applications Setup Wizard

Date: 2026-06-10
Topic: Automated initialization of managed applications

## Overview
A dedicated setup utility to handle the complete onboarding of projects defined in `apps.config.json`. This includes cloning missing repositories, installing dependencies, setting up environment files, and performing initial builds.

## Goals
- Automate the manual setup process for 5+ managed applications.
- Provide a clear, step-by-step progress report in the terminal.
- Ensure idempotency (running it twice shouldn't break anything).

## Architecture

### 1. Entry Point
- **Script:** `bin/setup.ts`
- **Command:** `npm run setup`
- **Execution:** Uses `tsx` for direct TypeScript execution.

### 2. Configuration Updates
The `AppConfig` type and `apps.config.json` will be extended to support:
- `repository`: The Git URL for cloning.
- `installCommand`: (Optional) Custom install command (default: `npm install`).
- `buildCommand`: (Optional) Custom build command (default: `npm run build`).

### 3. Execution Logic (Sequential per App)
For each application in `apps.config.json`:

1.  **Clone Phase:**
    - If `cwd` directory does not exist:
        - Read `repository` from config.
        - Execute `git clone <repository> <cwd>`.
2.  **Install Phase:**
    - If `node_modules` is missing:
        - Execute `npm install` (or custom command) in `cwd`.
3.  **Environment Phase:**
    - If `.env` is missing:
        - Check for `.env.example` or `.env.template`.
        - Copy to `.env` if found, otherwise create an empty `.env`.
4.  **Build Phase:**
    - Execute `npm run build` (or custom command) in `cwd`.

### 4. Error Handling
- If an app fails at any step, the script logs the error and proceeds to the next app.
- A final summary table shows the status (Success/Failed/Skipped) for each phase of each app.

## Success Criteria
- Running `npm run setup` on a fresh machine clones all repos.
- Running it again on an existing setup verifies all dependencies and builds.
- Clear console output using colors (green for success, red for errors).
