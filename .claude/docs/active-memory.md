# Active memory — living state

_Update this after every work chunk. Newest status at top._

## Current phase: **Calendar providers (ICS + Microsoft Graph OAuth) built and wired end-to-end. Next: real ICS URL / Azure AD app registration verification, SQLite, packaging**

## Snapshot (2026-08-03 session 4 — calendar provider + OAuth integration, ADR-011)
- **Built the full calendar pillar** per `plan-the-calendar-provider-zippy-dove.md`: `IcsCalendarSource` (new `ical.js` dep, recurrence expansion via `event.iterator()`/`getOccurrenceDetails`), `MicrosoftGraphCalendarSource` (`/me/calendarView`, resolver-callback shape), `WebRedirectOAuthService` + `pkce.ts` (PKCE via Web Crypto, popup + `postMessage`, no Tauri dependency — ships forward for desktop too) + `oauth-callback.tsx` (rendered by `App.tsx` on `?oauth=callback`). See ADR-011 for full wiring (`ConnectionManager.calendars()`/`saveCalendarAccount`/`connectMicrosoftAccount`/`probeCalendarAccount`, `container.listMeetings` real sync, `CalendarsSection` in Settings, all-day meetings hidden from one-click Start).
- **Verified in-browser** against the live Harvest connection (regression clean, no console errors): added + probed + edited + removed a test ICS calendar account end-to-end (probe correctly reports "Failed · Failed to fetch" for a non-CORS-open test host — expected, not a bug); Microsoft provider picker + Client ID field + "Connect with Microsoft" button render correctly with the right redirect URI (`http://localhost:1420/?oauth=callback`) in the helper text; Meetings tab shows the correct empty state when no calendar account is configured; existing Harvest/ADO Connected badge, Continue/Edit, Start all unaffected.
- **Not yet verified live** (needs the user): (1) a real published Outlook/Google ICS URL — CORS behavior varies by host, add to `DEV_PROXY_REWRITES`/`vite.config.ts` if a specific host 403s direct fetch; (2) the actual Azure AD app registration + full Graph OAuth round-trip (`agile-bridge` tenant may restrict self-service registration or require admin consent for `Calendars.Read` — flagged in the plan as a blocker to check first).
- 67 tests (10 new: `pkce.test.ts`, `ics-calendar-source.test.ts`, `microsoft-graph-calendar-source.test.ts`, `connection-manager.test.ts` calendar additions) + typecheck + build green.

## Snapshot (2026-08-03 session 3h — block un-linkable entries, end to end)
- **Domain guard:** `TrackingService.startTracking`/`logManualTime`/`updateInterval` throw `UnmappedEntryError` (new `domain/errors.ts`) when project+task is missing or partial. Covered by a dedicated test (blank, partial, and a simulated legacy-unmapped entry that can't be re-saved without adding a mapping).
- **UI enforces the same rule with zero silent defaults:** `EntryModal` no longer auto-picks the first Harvest project for a new entry (previously did, defeating the point); Save/Start/Add is disabled + shows "Harvest is the source of truth — pick a project and task before saving." until both are chosen. Verified live (button `disabled` flips false→true only after picking a real project).
- **Unmapped Start/Log routes through the modal instead of failing:** new global `useEntryModalStore` (`presentation/state/entry-modal.ts`) + `NewEntryPrefill`. `WorkItemCard`/`MeetingCard`(new, extracted from `MeetingsTab`)/quick-templates check their resolved mapping; if mapped, one-click Start as before (unchanged, no friction); if not, opens the modal prefilled with notes + `workItemRef`/`templateId`/`source` (and a meeting's computed duration for "Log", so it defaults to "Add" not "Start"). `ManualEntryInput`/`startManual`/`logManual` now carry an optional `source` override + `workItemRef`/`templateId` so the context survives into the actual `startTracking`/`logManualTime` call. Added `useMeetingMapping` hook (mirrors `useWorkItemMapping`).
- 57 tests + typecheck + build green.

## Snapshot (2026-08-03 session 3g — flexible time editor in the entry modal)
- **Edit/new modal now sets optional time "extras":** Start, End, Duration fields kept in sync — enter any of start+end, start+duration, end+duration, or duration-only. Times are local HH:MM ↔ ISO (`entry-modal.tsx` `resolveTimes`). `logManual` hook + `logManualTime` carry explicit start/end; edit builds a `{start,end}` patch. Verified in-browser (09:00 + 1:30 → End auto-fills 10:30, button → "Add time entry"). Typecheck/build green, 56 tests.

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

## Snapshot (2026-08-11 — F1: hg1 codec tests + pluggable encoding, ADR-012)
- **F1 done.** hg1 fenced-block body encoding is now pluggable behind a sync domain `Hg1Codec` port, with the body self-describing its scheme via a `<letter><digit>:` prefix (unprefixed = `plain`, byte-for-byte identical to the old format — no migration, existing tags decode unchanged). New: `domain/harvest/hg1-codec.ts` (`Hg1Codec`, `Hg1Scheme`, `Hg1CodecUnavailableError`), `plain-hg1-codec.ts` (default; hosts the base64url helpers moved out of `hg1-metadata.ts`), `scramble-hg1-codec.ts` (keyless reversible XOR+base64url, `s1:` prefix), `hg1-codec-registry.ts` (`codecFor`/`codecForBody`). `hg1-metadata.ts` `encode`/`embed` take an optional codec (default plain); `extract` auto-detects per-body via `codecForBody`. `Settings.hg1Scheme: Hg1Scheme` added, default `'plain'`; `TrackingService.pushToHarvest` reads it alongside `embedMetadata` and resolves the codec. `aes` (`a1:`) is reserved in the type but **not implemented** — `codecFor('aes')` throws; real encryption needs `ISecretStore` (async), which doesn't fit the domain's pure/sync layer, so it'll need an infra wrapper later. See ADR-012.
- **Tests:** co-located `hg1-metadata.test.ts`, `plain-hg1-codec.test.ts`, `scramble-hg1-codec.test.ts` under `src/domain/harvest/`; the duplicate `describe('Hg1 metadata codec')` block was removed from `src/domain/services/services.test.ts`. Suite: **91 tests passing** (was 67), typecheck green.
- **Open questions (not decided, flagged for a future session):**
  1. AES key provenance — per-install key pulled from `ISecretStore` vs a user-supplied passphrase (affects UX and whether the key travels with a backup/restore).
  2. AES portability tradeoff — an AES-encrypted hg1 tag isn't decodable on a fresh install without the same key, which cuts against hg1's own stated recovery/portability purpose (ADR-009's rationale for embedding metadata at all). Needs a product call on whether that's acceptable or whether `aes` should always ship a companion recovery path.
  3. Whether to expose `scramble` in the Settings UI now, or leave `hg1Scheme` DB-only/`plain`-only until there's a real reason (e.g. a user asking not to have plaintext-ish tags visible) to surface it.

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
3. ✅ **Calendar providers (task #10)** — done (session 4, ADR-011): ICS + Microsoft Graph, web-popup PKCE OAuth (no Tauri runtime needed after all — ships forward for desktop). Google deferred (same port shape). Real-world verification (Azure AD app registration, a real ICS URL) still needed from the user.
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
