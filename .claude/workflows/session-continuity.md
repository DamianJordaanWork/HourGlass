# Workflow: session continuity

How to resume Hourglass in a fresh session (or after a context reset).

## Resume checklist
1. Read `.claude/docs/active-memory.md` — the current phase, what's done, what's next, and gotchas. This is the single most important file.
2. Skim `.claude/docs/architecture.md` (layers + ADR log) and `.claude/standards/` (coding + design).
3. Check outstanding tasks (TaskList) and background jobs (e.g. toolchain install).
4. `npm install` if `node_modules` is missing; `npm run dev` to sanity-check the app renders.
5. Continue from "Next steps" in active-memory.

## Before ending a session (or when context is running low)
- Update `active-memory.md`: move finished items to Done, refresh In-progress and Next-steps, note any new gotcha or decision-in-flight.
- Ensure typecheck + tests pass, or record exactly what's broken and why in active-memory.
- Append an ADR to `architecture.md` for any structural decision made.
- The approved master plan is at `C:\Users\DamianJordaan\.claude\plans\grain-c-users-damianjordaan-projects-oth-generic-grove.md` — treat it as the spec.

Leave the repo so the next session needs no verbal handoff.
