# Workflow: release

## Desktop build
```bash
npm run typecheck && npm run test
npm run tauri build
```
Output: `src-tauri/target/release/bundle/` — Windows `.msi` (WiX) and/or `.exe` (NSIS). Version comes from `src-tauri/tauri.conf.json` (`version`) — bump it per release.

## Pre-release checklist
- Typecheck + tests green.
- Settings work end-to-end: Harvest PAT, ADO connection, calendar OAuth (Outlook + Google).
- Core loop verified: start/stop a ticket → appears in Harvest + ADO widget + CompletedWork; log a meeting; separate entries per Start; day selector stamps correctly.
- `active-memory.md` updated; ADRs current.

## Web target (Phase 3)
`npm run build` → static SPA + a thin CORS/OAuth-redirect proxy for Harvest/ADO/calendars. Not the primary distribution.

## Auto-update (later)
Tauri updater plugin + a signed release feed. Deferred to polish phase.
