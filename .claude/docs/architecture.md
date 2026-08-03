# Architecture

Clean architecture + SOLID. Dependencies point **inward**: `presentation → application → domain` and `infrastructure → domain`. The `composition` root is the only place that knows concrete adapters.

```
src/
  domain/          pure TS. entities, value objects, domain services, PORT interfaces. no I/O.
  application/     use cases + DTOs. orchestrate domain via ports. no framework, no I/O detail.
  infrastructure/  adapters implementing ports (SQLite, Harvest, ADO, calendars, OAuth, secrets, http).
  presentation/    React UI, hooks (TanStack Query + Zustand), styles/tokens.
  composition/     DI container/factory + platform detection (desktop vs web) + config bootstrap.
```

## Ports (in `domain`) → adapters (in `infrastructure`)

| Port | Adapter(s) |
|---|---|
| `IHarvestClient` | `HarvestClient` (REST v2, Bearer PAT + `Harvest-Account-Id`) |
| `IAzureDevOpsClient` | `AzureDevOpsClient` (REST v7; native composite-ID refs, CompletedWork delta) |
| `ICalendarSource` | `MicrosoftGraphCalendarClient`, `GoogleCalendarClient`, `IcsCalendarClient` |
| `IOAuthService` | `OAuthService` (PKCE + loopback via tauri-plugin-oauth) |
| `ITimeIntervalRepository`, `IMappingRuleRepository`, `IQuickTemplateRepository`, `ICalendarAccountRepository`, `IMeetingRepository`, `INoteRepository`, `ISettingsRepository` | SQLite repos |
| `ISecretStore` | OS keychain (Tauri stronghold/keyring) |
| `IHttpTransport` | Tauri HTTP plugin (desktop, no CORS) / dev-proxy (web) |
| `IClock` | system clock (injectable for tests) |

## Domain services (pure, unit-tested)

- `TemplateMatcher.resolve(context, rules)` — first enabled rule (by priority) whose conditions all match → `{harvestProjectId, harvestTaskId, noteTemplate}`.
- `IntervalAggregator` — sums intervals into per-entry hours.
- `DeadTimeCalculator` — gaps/context-switches/productivity within work-day bounds.
- `WeeklyGoalCalculator` — daily/weekly goal + expected-hours tick.

## Data model (SQLite) — summary

`time_interval` (granular unit; each Start = a new interval → its own Harvest entry by default), `mapping_rule` + `mapping_condition`, `quick_template`, `calendar_account` + `meeting`, `note` + `note_status`, `ado_connection`, `settings` (singleton). Full columns in the approved plan.

## Key flows

- **Start tracking:** create running interval (date = selected day) → resolve template → attach ADO ref → auto-stop prior timer (configurable).
- **Stop:** compute hours → POST/PATCH Harvest → write ADO native ref + `hg1` metadata → delta-sync CompletedWork.
- **Meeting log:** interval with explicit duration; prefill from event + resolved mapping.
- **Calendar sync:** OAuth per account → fetch selected day (Graph `calendarView` / Google `singleEvents`) → expand recurrences, skip all-day → upsert meetings.
- **Resilience:** SQLite is truth; every remote call best-effort with retry/reconcile; background refresh guarded by request-id so it never clobbers optimistic mutations.

## Hybrid Harvest metadata (`hg1`)

Below the user's note body (two blank lines), a fenced ` ```hg1 ` block with base64url JSON `{v,intervalId,templateId,source,ado}`, optionally scrambled/AES-encrypted (per-install keychain key). Hidden on display, decoded for reconciliation, regenerated on write. Reconciliation-only — SQLite remains source of truth.

## ADR log

- **ADR-001 — Stack: React+TS+Tauri.** Chosen over Flutter and C#/.NET after mobile was dropped from scope; Tauri gives standalone desktop + a web build from one React UI. See plan.
- **ADR-002 — Storage: SQLite hybrid.** Local-first SQLite (serverless, portable, keeps interval analytics) + embedded Harvest metadata; rejected fully-SQL-less (fragile) and server DB (blocks standalone).
- **ADR-003 — Desktop-first for API calls.** Harvest/ADO/calendars reject browser CORS; Tauri HTTP plugin proxies via Rust. Web target adds a thin proxy in Phase 3.
- **ADR-004 — Tailwind v4 + CSS-variable tokens.** Tokens in `src/presentation/styles/tokens.css` are the single source of truth, mapped into Tailwind via `@theme inline`. Theme via `data-theme` on `<html>` + `prefers-color-scheme`.
- **ADR-005 — Vitest 3 (not 2).** Vitest 2 pinned its own Vite 5 under our Vite 6, causing plugin type clashes; Vitest 3 dedupes to a single Vite 6.
- **ADR-006 — Each Start = separate Harvest entry.** Per user requirement (no roll-up). Optional aggregate toggle deferred to Phase 2.
- **ADR-009 — Harvest is the source of truth (refines ADR-002).** Per product direction, a persisted entry is meaningful only when linked to a Harvest entry (`harvestTimeEntryId`); local SQLite is the working cache/link + analytics store, not the authority. Consequences implemented: (a) **hg1 stores only non-native data** — `{ v, source, templateId? }`; project/task/notes/hours/date and the ADO link (native `external_reference`) are dropped, and the tag is only embedded when non-default (keeps notes clean). (b) **Never push `hours ≤ 0`** — Harvest treats a timeless entry as a *running* timer, which would collide with our local timing (dual timer); we time locally and always push explicit positive hours on stop. (c) **Harvest entries are first-class**: `importHarvestEntry` adopts an external entry into a local interval; `linkToHarvestEntry` attaches a local interval to an existing Harvest entry; external (Harvest-only) rows support Start (new timer)/Edit(adopt+update)/Delete(`deleteTimeEntry`). (d) **Delete moved into the edit modal** behind a two-step confirm (card delete was too easy to hit). Deferred: blocking starts that can't map to Harvest; reconciling divergent hours on link.
- **ADR-008 — Edit/restart/manual entries + Harvest-entry reconciliation.** `TimeInterval` gained `syncedHours` (hours last pushed) so edits push **absolute** hours to Harvest but only the **delta** (`newHours − syncedHours`) to ADO CompletedWork — no double-counting on re-sync. `TrackingService.updateInterval` (marks `isManual`, re-derives hours from start/end, re-pushes) and `restartInterval` (clones a stopped entry into a fresh running timer — consistent with "each Start = new interval", ADR-006) added. The timesheet reconciles by `harvestTimeEntryId`: Harvest entries matching a local interval are hidden (local wins, editable); unmatched Harvest entries render **read-only** ("Harvest" badge) and count toward day/week totals. Editing/adopting those external entries is deferred. Manual entry uses one modal (`entry-modal.tsx`): duration `0:00` → live `startTracking`, else `logManualTime`. Web dev pulls entries through the Vite proxy (ADR-003/007).
- **ADR-007 — Runtime connection wiring via a `ConnectionManager` + lazy client providers.** Real Harvest/ADO adapters are built from persisted config + secrets by `infrastructure/connections/connection-manager.ts`, which holds the live clients and rebuilds them on `reconfigure()` (called after any Settings save). It lives in infrastructure because it constructs concrete adapters; the composition root wires it and the container falls back to seeded demo data whenever `configured()` is false. `TrackingService.harvest/ado` became **provider functions** (`() => IHarvestClient | undefined`) so the manager can swap the underlying client without rebuilding the service and so demo mode skips sync silently (no spurious warnings). Rejected: rebuilding the whole container/tracking-service on config change (the container is a stable singleton read live by hooks) and always-present delegating clients (would emit false sync warnings in demo mode). Secrets go through `ISecretStore`; the web/dev adapter (`LocalSecretStore`) is localStorage-backed (**not** hardware-backed) and is swapped for the OS keychain (Tauri stronghold) on desktop behind the same port. `IHttpTransport` currently resolves to `FetchHttpTransport` for both platforms (`createHttpTransport()`); the Tauri native branch (no CORS) slots in there later. ADR-003's CORS caveat stands: live Harvest/ADO calls only work in the desktop shell (or via a web proxy) — the plain web build will fail direct calls.
