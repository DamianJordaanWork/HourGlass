# Hourglass

The ultimate personal time tracker: **quick-track Azure DevOps tickets and calendar meetings straight into Harvest**, with a templating engine that auto-maps them to the right Harvest project/task. Local-first (SQLite) with resilient best-effort Harvest sync, ported from two predecessor apps (Grain — deep ADO integration; HarvestTracker — resilient interval model + analytics).

## Stack

- **Frontend/app:** React 18 + TypeScript (strict) + Vite 6, styled with Tailwind v4 + CSS-variable tokens.
- **Desktop shell:** Tauri v2 (standalone desktop; the same SPA is the web build). Rust shell is generated config, rarely edited.
- **Storage:** SQLite local-first source of truth (Tauri SQL plugin on desktop; WASM SQLite on web later) + compact `hg1` metadata embedded in Harvest entries for portability/recovery.
- **Architecture:** Clean architecture + SOLID — `domain → application → infrastructure → presentation`, wired at a `composition` root. Dependencies point inward.
- **State:** TanStack Query (async/server cache) + Zustand (UI state).

## Run / build / test

```bash
npm install
npm run dev        # Vite dev server on http://localhost:1420 (web mode, no Rust needed)
npm run build      # tsc -b && vite build
npm run test       # vitest run
npm run typecheck  # tsc -b --noEmit
# npm run tauri dev / build  -> desktop (requires Rust + MSVC C++ Build Tools)
```

## Where things live

- `src/domain/` — pure entities, value objects, domain services, port interfaces. No I/O, no framework.
- `src/application/` — use cases + DTOs, depend only on domain ports.
- `src/infrastructure/` — adapters (SQLite repos, Harvest/ADO/calendar clients, OAuth, secrets, http).
- `src/presentation/` — React UI, hooks, `styles/` design tokens.
- `src/composition/` — DI wiring + platform detection.
- `src-tauri/` — Tauri shell (added once toolchain is installed).

## Start here every session

1. Read **`.claude/docs/active-memory.md`** — current phase, what's done, what's next, gotchas.
2. Skim **`.claude/docs/architecture.md`** for layer boundaries + ADRs.
3. Follow **`.claude/standards/`** (coding + design system) — they are authoritative.
4. Workflows for common procedures live in **`.claude/workflows/`**.

**Discipline:** update `active-memory.md` after each work chunk; append an ADR to `architecture.md` on any structural decision. Full approved plan: `C:\Users\DamianJordaan\.claude\plans\grain-c-users-damianjordaan-projects-oth-generic-grove.md`.
