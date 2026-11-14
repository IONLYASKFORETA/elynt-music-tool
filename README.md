# Elynt Music Tool

One desktop app for producing and releasing EDM tracks, with three tools: the **Visualizer**, the **Mix & Master Assistant** and the **Release Assistant**. See `GLOSSARY.md` for the terms and `docs/adr/` for the big decisions.

## Requirements

- Node.js 22.13 or newer (the app and the tests use the built-in `node:sqlite`)
- Windows is the target platform; development also works on macOS and Linux
- The Python helper (heavy work, Python 3.12, runs in WSL2 on Windows): set it up once with `helper/README.md`. The app still opens without it and shows "Helper not set up".

## Run the app in dev

```sh
npm install
npm run dev
```

`npm run dev` starts Electron with hot reload. The first run downloads the Electron binary.

## Run the tests

```sh
npm test            # runs every test once (what CI runs)
npm run test:watch  # re-runs tests as you edit
npm run typecheck
```

## Where things live

- `src/main/` is the Electron main process: the suite database (`db/`) and the track library.
- `src/preload/` exposes a small `window.elynt` API to the UI.
- `src/renderer/` is the React UI.
- `src/main/helper/` starts the Python helper, restarts it if it dies, and makes typed calls to it.
- `src/shared/` holds types used on both sides.
- `helper/` is the Python helper itself (ADR 0001, ADR 0003).

All records live in one SQLite file, `elynt.sqlite`, in the app's data folder (`%APPDATA%\elynt-music-tool` on Windows). Audio stays where it is on disk and the database stores only its path (ADR 0002).

## Adding tables

Append a migration to `src/main/db/migrations.ts` with the next version number. Migrations run in order when the database opens, and the file's schema version is kept in SQLite's `user_version`. Never edit a migration that has already shipped.
