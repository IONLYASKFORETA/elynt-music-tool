# One local SQLite database for the whole suite, with shared track records

Elynt Music Tool keeps all of its records in one SQLite file in the app's data folder: the artist profile, tracks, releases, release plans, drafts, check-ins, retrospectives, and whatever the Visualizer and the Mix & Master Assistant store. Audio and video files stay where they are on disk, and the database records only their paths. We chose one local file because the suite has one owner on one Windows PC and needs no account or server. Just as important, the three tools work on the same **track**: a release, a vision and a mix session all point at one shared track record. A clip the Visualizer renders is then available to the release plan straight away.

## Consequences

- Every day a copy of the database goes to a folder the owner chooses (for example OneDrive or Dropbox). A manual "export everything" writes a single file. Nothing syncs between machines.
- The Release Assistant's playbook ships as a versioned data file. Each release plan records the version that built it, so an app update never rewrites a plan that's already running.
- Decided in [Decide where releases are stored and linked to tracks](https://github.com/IONLYASKFORETA/elynt-music-tool/issues/42) on 2026-11-13. Builds on ADR 0001 (Electron shell).
