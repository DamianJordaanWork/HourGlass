# Active memory — living state

_Update this after every work chunk. Newest status at top._

## Current phase: **Harvest = source of truth; entries fully manageable (continue/edit/delete/link + adopt Harvest entries); metadata opt-in. Next: calendar OAuth, SQLite, packaging**

## Snapshot (2026-08-03 session 3f — metadata toggle + continue-not-restart)
- **hg1 embedding is now opt-in.** New `Settings.embedMetadata` (**default false**); Settings → "Harvest sync" card toggles it. `TrackingService.pushToHarvest` reads it; off (or default-value) → notes stay clean and any stale tag is stripped on next sync. `embedMetadata(interval, enabled)` gated on the flag.
- **"Continue", not "Restart".** Replaced `restartInterval` (clone→new entry) with `continueInterval` (reopens the SAME interval; shifts `start` back by already-logged time so the clock resumes from the accrued total and the next stop UPDATES the same Harvest entry — no new entry). Local card button "Restart"→**Continue**; external Harvest row "Start"→**Continue** (`continueFromEntry` = import + continue). Covered by a new unit test (same-id, resume-from-accrued, updates same entry).
- 56 tests + typecheck + build green; verified in-browser (Continue labels + Harvest-sync toggle).

## Snapshot (2026-08-03 session 3e — Harvest source-of-truth + git)
- **Model clarified: Harvest is source of truth** (see ADR-009). Local SQLite is the cache/link + analytics. Implemented:
  - **hg1 trimmed** to `{ v, source, templateId? }` (dropped `intervalId` + `ado` — ADO link is native `external_reference`; reconcile via `harvestTimeEntryId`). Only embedded when non-default → clean Harvest notes.
  - **Dual-timer guard**: `pushToHarvest` never sends `hours ≤ 0` (Harvest reads a timeless entry as a running timer). We time locally; positive hours pushed on stop.
  - **Harvest entries first-class**: `TrackingService.importHarvestEntry` (adopt), `linkToHarvestEntry` (attach existing); container `deleteHarvestEntry`. External (Harvest-only) rows now have **Start / Edit / Delete**; local entries have **Restart / Edit**; **delete moved into the edit modal behind a 2-step confirm** (card ✕ removed). Edit modal has a **"Link to existing Harvest entry"** picker.
- **Git initialized & committed.** Repo was commitless; baseline `chore: initial commit` (bd430bd) + this feature commit. `*.tsbuildinfo` added to `.gitignore`. Local-only, no remote — commit as work lands.
- **Verified in-browser** against the live Harvest account: edit modal shows "Linked to Harvest #…", 2-step delete confirm, external rows Start/Edit. 56 tests + typecheck + build green.
- **Deferred:** blocking un-mappable starts; reconciling divergent hours when linking; explicit start-time field; editing Harvest-only entries preserves synthetic times (hours exact).

## Snapshot (2026-08-03 session 3d — edit / restart / manual entry / show Harvest entries)
- **All four requests shipped & verified in-browser** (real Harvest connection):
  1. **Existing Harvest entries show** in the day/week view — timesheet reconciles by `harvestTimeEntryId`; unmatched Harvest entries render read-only with a "Harvest" badge (e.g. "Agile Bridge Operations · Meetings — Morning Check-in — 10m") and count toward day + week totals. `container.listHarvestEntries(from,to)` + `useHarvestEntries`.
  2. **Edit** entries via `EntryModal` (`components/entry-modal.tsx`, mode edit) → `TrackingService.updateInterval`.
  3. **Restart** a stopped entry → `TrackingService.restartInterval` (clones into a fresh running timer).
  4. **Manual entry** modal mirroring Harvest's ("New time entry for <day>", Project/Task selects, Notes, 0:00 duration): 0:00 → live `startTracking`; duration → `logManualTime`. "+ Add entry" button on the timesheet.
- **Sync correctness:** `TimeInterval.syncedHours` added → edits push absolute hours to Harvest, only the delta to ADO CompletedWork (no double count). See ADR-008. Shared `components/harvest-picker.tsx` (extracted from templates; `resolveNames` helper) used by templates + modal.
- **Confirmed working:** user logged a real entry that shows "TFN Project Development | CRT Team · Development"; ADO work items map to real Harvest projects via user-authored rules. 54 tests + typecheck + build green.
- **Known gaps:** external (Harvest-only) entries are read-only — no edit/adopt yet. Manual/edit modal keeps original `start` and sets `end = start + duration` (no explicit start-time field yet).

## (superseded) Current phase note — Harvest + ADO LIVE via dev proxy; push path proven.

## Snapshot (2026-08-03 session 3c — root-caused "time doesn't reach Harvest")
- **Confirmed via network+console:** `GET /__harvest/v2/users/me/project_assignments → 200` (auth+proxy good), but `POST /__harvest/v2/time_entries → 422 {"message":"Project must exist, User isn't assigned…, Task doesn't exist"}`. Cause = seeded **demo mapping rules/quick-templates target placeholder Harvest ids (1001/1002/1003)** that don't exist in the real account. Transport/proxy/auth/sync-logic all correct.
- **Fix shipped:** `demo-data.ts` `clearBrokenDemoSeed()` removes seeded rules/templates still pointing at placeholder ids; `container.ts` `ready` now **reconfigures first**, then seeds demo only when `!isConfigured()`, else strips the broken placeholders. Verified in-browser: Templates now shows "No mapping rules / No quick templates" when connected; work items read **Unmapped** (honest). 52 tests + typecheck + build green.
- **NEXT (blocker for the user's goal):** author real mapping rules in the Templates UI (ADO project → a real Harvest project+task the user is assigned to). Their ADO items look TFN-related; Harvest has several "TFN Project Development | <team>" projects — the team+task choice is the user's. Once one real rule exists, Start→Stop should POST 201 and appear in Harvest. Also still wanted (separate feature): **import existing Harvest entries** into the day/week view (`getTimeEntries()` exists but is uncalled).


## Snapshot (2026-08-03 session 3b — dev proxy + template-management UI, Harvest confirmed live)
- **Harvest is live.** User pasted their Harvest PAT/account id in Settings; badge shows **Connected** and the template pickers load **real Harvest projects** (e.g. "TFN Project Development | NITO Team", "Graduate Project 2026", "Agile Bridge Operations"). Verified in-browser.
- **CORS solved for web dev via a Vite proxy.** `vite.config.ts` `server.proxy` maps `/__harvest`→`https://api.harvestapp.com` and `/__ado`→`https://dev.azure.com`; `FetchHttpTransport` rewrites those hosts to the prefixes when `import.meta.env.DEV && !isTauri()` (see `createHttpTransport`). **Requires a dev-server restart to take effect** (Vite doesn't hot-reload proxy config). Desktop (Tauri) will call hosts directly.
- **Template-management UI built** (`components/templates.tsx`, new `'templates'` view + nav). Mapping-rules CRUD (name, type, priority, enabled, condition rows: field/operator/value/negate, Harvest project+task picker, note template) and quick-templates CRUD (label/icon/colour/project+task/notes/enabled). Hooks in `hooks/use-templates.ts`. `container.harvestProjectOptions()` feeds pickers (live projects via `ConnectionManager.projects()`, else demo fallback).
- **⚠️ Seeded demo mapping rules point at FAKE Harvest ids (1001/1002/1003, task 10/20/30/40)** — they won't match real Harvest projects. User should rebuild rules/templates against the real projects now shown in the pickers (that's what this UI is for). Consider gating `seedDemo` on `!configured` in a later pass.
- **Still to verify live:** ADO work items in the source rail (needs the connection enabled + probe green through the proxy). 52 tests, typecheck, build all green.

## Snapshot (2026-08-03 session 3 — Settings/Connections + real adapters)
- **52 tests, typecheck + build green.** New **Settings** view (`components/settings.tsx`, view `'settings'` in `state/view.ts`): Harvest (account id + PAT, Save & test, Disconnect), Azure DevOps (multi-connection list with enable toggle / edit / remove + add form, per-connection PAT), Work day & goals (edits the existing `Settings` fields). Top-bar badge is now dynamic: **Connected** vs **Demo data** (click → Settings), driven by `useConnectionStatus`.
- **Real adapters wired, guarded.** `infrastructure/connections/connection-manager.ts` (`ConnectionManager`, tested) builds live `HarvestClient`/`AzureDevOpsClient` from persisted config + secrets, holds them, and `reconfigure()`s after every save; probes creds (Harvest `getProjectAssignments`, ADO `listAssignedWorkItems`) → `Probe` shown in UI. `composition/container.ts` uses it: `listWorkItems`/`listMeetings`/`harvestName`/`isConfigured` fall back to demo when nothing configured. `TrackingService.harvest/ado` are now **provider fns** so live clients swap without rebuild and demo mode stays silent (see ADR-007).
- **New infra:** `secrets/local-secret-store.ts` (`ISecretStore`, localStorage; swap for Tauri stronghold on desktop), `http/http-transport.ts` (`FetchHttpTransport` + `createHttpTransport()`/`isTauri()`), `AdoConnectionRepository` in `local-repositories.ts`. New domain: `connections/connection.ts` (`AdoConnection`, `HARVEST_TOKEN_KEY`, `adoPatKey`) + `IAdoConnectionRepository` port.
- **Hooks:** `hooks/use-connections.ts` (`useConnectionStatus`, `useConnectionActions`), `useSaveSettings` added to `use-settings.ts`.
- **⚠️ Live calls need the desktop shell (or a web proxy).** In `npm run dev` a real Save & test will hit CORS on Harvest/ADO (ADR-003). The wiring is correct; verify live once Tauri HTTP is added, OR add a dev proxy. **User to paste Harvest PAT/account id + ADO PAT into the Settings UI** (that's the "where").
- **Next:** verify live (desktop/proxy) → calendar providers + OAuth → template-management UI → SQLite backend → Tauri plugins/packaging.

## Snapshot (2026-08-03 session 2 — Phase 2 done)
- **Working app, 3 views, 45 tests, build green.** Timesheet (quick-track ADO tickets/meetings/templates → mapped intervals, live timer, day/week strip), **Insights** (`components/insights.tsx` — weekly goal ring + productivity/dead-time/context-switch tiles + gaps, via tested `DeadTimeCalculator`/`WeeklyGoalCalculator`; window built in `presentation/lib/work-window.ts`), **Notes** (`components/notes.tsx` — add/color/WIP/done/delete + start-timer-from-note). View switch: `state/view.ts`, nav in `app/App.tsx`.
- New domain: `notes/note.ts` (+ `INoteRepository`, local repo). Container exposes `newId()`.

## Remaining to make it "real" (next sessions, roughly in order)
1. **Settings + Connections UI**: enter Harvest PAT + account id; add ADO connection(s); manage calendars. Persist creds to keychain (desktop) — currently no Settings UI.
2. **Wire real adapters in `composition/container.ts`**: build `HttpTransport` (Tauri HTTP plugin desktop / proxy web), `HarvestClient`, `AzureDevOpsClient` from configured connections; replace demo `listWorkItems`/`listMeetings`. Clients + tracking already support this.
3. **Calendar providers (task #10)**: `MicrosoftGraphCalendarClient`, `GoogleCalendarClient`, `IcsCalendarClient` (map to `Meeting`), + `OAuthService` PKCE loopback (`tauri-plugin-oauth`). Needs Tauri runtime; add plugin to `src-tauri`.
4. **Template-management UI**: CRUD for `mapping_rule` + `quick_template` (engine + repos already done/tested).
5. **SQLite/Tauri-sql repo backend**: swap `local-repositories` impl behind same ports (add `@tauri-apps/plugin-sql`, schema, migrations).
6. **Tauri plugins + packaging**: add sql/http/oauth/stronghold to `src-tauri/Cargo.toml` + capabilities; `tauri build`. hg1 encryption option; ADO Harvest-GUID auto-learn.

## Gotcha
- `work-window.ts`: `endMs = min(workEnd, max(now, start))` so running timers don't over-report before workday start / on future days.

## Snapshot (2026-08-03 session 2 — MVP milestone)
- **MVP core loop verified in the browser:** click Start on an ADO ticket → template engine auto-maps it (e.g. LetsDrive→Development) → live teal timer ticks → entry lands in the day/week timesheet → Stop works. Meetings (Log/Start) and Quick Templates wired too. 45 tests pass; `npm run build` green.
- **Wiring:** `composition/container.ts` (demo mode: seeded ADO items/meetings/rules/templates, local persistence, no live Harvest). React via `container-context.tsx` + TanStack Query hooks (`presentation/hooks/use-tracking.ts`) + `selected-day` Zustand store. Components: `components/timesheet.tsx` (DaySelector/week strip, RunningTimerBanner, TimesheetPane, EntryCard), `components/source-rail.tsx` (Work Items / Meetings / Templates).
- **Still demo-only:** real Harvest/ADO/calendar need credentials + Tauri HTTP transport (not wired). `container.ts` is where real adapters slot in. Template-management UI + Settings UI not built yet. SQLite backend still deferred (localStorage repos in use).

## Current phase (history): Phase 1 — infrastructure done, building use cases + UI

## Snapshot (2026-08-03 session 2)
- **40 tests passing**, typecheck clean. Layers built so far:
  - Domain: entities, ports, TemplateMatcher, IntervalAggregator, DeadTimeCalculator, WeeklyGoalCalculator, Hg1 codec (all tested).
  - Infrastructure: `HarvestClient` + `AzureDevOpsClient` (against `IHttpTransport`, tested with `@test/fake-transport`); local persistence (`LocalCollection`/`LocalValue` + repositories for all aggregates, tested with `MemoryStorage`).
- **Deferred (clean swaps, same ports):** SQLite/Tauri-sql repo backend (currently localStorage-backed — works in web + Tauri webview); interactive calendar OAuth flow (needs Tauri runtime); calendar provider clients (Graph/Google/ICS) not yet written.
- **Next:** application use cases + `IClock` + composition root (dev wiring with seed data) → timesheet + source-rail UI wired to use cases → then calendar providers, analytics, notes.


## Done
- ✅ Vite 6 + React 18 + TS (strict) + Tailwind v4 scaffold. `npm run build`, `dev` (`:1420`), `typecheck`, `test` all green. Two-pane shell renders (verified via browser read_page).
- ✅ Design tokens (`src/presentation/styles/tokens.css`) mapped to Tailwind (`index.css`); theme store `src/presentation/state/theme.ts`.
- ✅ Path aliases; `.gitignore`; `public/hourglass.svg`.
- ✅ `.claude/` knowledge base (CLAUDE.md + docs + standards + workflows).
- ✅ **Toolchain fully working:** Rust 1.97.1 + MSVC C++ Build Tools installed. Tauri shell scaffolded (`src-tauri/`) and **`cargo build` succeeded** (native app compiles, exit 0). `.cargo/bin` must be on PATH for cargo (PowerShell: prepend `$env:USERPROFILE\.cargo\bin`).
- ✅ **Domain core started** (task #4): `common/types.ts`, `common/clock.ts`, `time/time-interval.ts`, `harvest/harvest-types.ts`, `work-items/work-item.ts` (+context builder), `calendar/meeting.ts` (+context builder, duration), `ports.ts`. **`templates/mapping.ts` TemplateMatcher fully implemented + 14 passing tests** (all operators, arrays, negate, AND, priority resolve).

## In progress
- ⏳ Domain layer (task #4): remaining pure services — `IntervalAggregator`, `DeadTimeCalculator`, `WeeklyGoalCalculator`, and the `hg1` metadata codec — each with tests.

## Next steps (in order)
1. Finish remaining domain services + tests (task #4).
2. Phase 1 infra: Tauri plugins (sql, http, oauth, stronghold) → SQLite schema + repos → `HarvestClient` → `AzureDevOpsClient` → calendar OAuth adapters.
3. Phase 1 app/UI: use cases → timesheet (day/week) → source rail (Work Items / Meetings / Templates) → template management UI.

## Gotchas / decisions in flight
- Vitest must stay **v3** (see ADR-005). Don't downgrade.
- `defineConfig` in `vite.config.ts` is imported from **`vitest/config`** (types the `test` key).
- Tauri `src-tauri/` not created yet — deferred until MSVC build tools land. Web dev works without it.
- Harvest/ADO/calendar live calls need Tauri HTTP (desktop) or a proxy (web) — do NOT expect them to work in plain `vite dev` without a proxy.
- Open Phase-1 decisions: calendar OAuth client IDs (bundle vs user-registered; agile-bridge tenant may need admin consent); `hg1` encoding level (plain/scrambled/encrypted).

## Environment facts
- Node v24.12, npm 11.6. WebView2 present. winget available. dotnet present (unrelated).
- ADO org: `agile-bridge` (projects incl. LetsDrive, TFN Project, Grad2026). Reachable via `ado` MCP for reference, but the app needs its own PAT-based ADO client.
- Harvest: user cannot add calendars via Harvest — calendars must come from Hourglass (Outlook + Gmail OAuth).
