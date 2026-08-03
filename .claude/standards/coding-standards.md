# Coding standards

## Language / tooling
- TypeScript **strict**; no `any` (use `unknown` + narrowing). No non-null `!` except provably-safe (comment why).
- ES modules, `verbatimModuleSyntax` → use `import type { ... }` for type-only imports.
- Prettier-style: 2-space indent, single quotes, semicolons, trailing commas.

## Layer boundaries (enforced by review)
- `domain/` imports **nothing** outside domain. No React, no fetch, no Tauri, no Date.now() (inject `IClock`).
- `application/` imports domain only. Returns DTOs, throws domain errors.
- `infrastructure/` implements domain ports; the only place with I/O, SQL, fetch, Tauri APIs.
- `presentation/` imports application + domain types; never instantiates adapters directly — gets them from the composition root / hooks.
- Cross-layer wiring happens **only** in `composition/`.
- Use path aliases (`@domain/...`), never deep relative `../../..` across layers.

## Naming
- Files: `kebab-case.ts`; React components `PascalCase.tsx`. Types/interfaces `PascalCase`; ports prefixed `I` (`IHarvestClient`). Functions/vars `camelCase`.
- One primary export per file where reasonable; co-locate `*.test.ts` beside source.

## Errors & resilience
- Domain throws typed errors (`class XError extends Error`). Adapters translate transport errors to domain errors.
- Remote calls (Harvest/ADO/calendar) are **best-effort**: never lose local data on failure; log + surface a non-blocking toast; SQLite stays source of truth.

## Testing
- Vitest. **Every domain service and client mapping has unit tests** (`TemplateMatcher` operators, aggregation, dead-time, snake_case DTO mapping, `hg1` encode/decode round-trip).
- Pure functions preferred → test without mocks. Inject `IClock`/ports for determinism.
- Component tests (React Testing Library) for interactive UI; keep them behaviour-focused.

## React
- Function components + hooks. Server/async state → TanStack Query; UI state → Zustand. No prop-drilling of adapters.
- Keep components presentational; push logic into hooks/use-cases.

## Commits
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. Imperative, scoped where useful (`feat(templates): ...`).
- End messages with the required `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- Branch off default before committing; commit/push only when asked.

## Definition of done (every change)
Typecheck + tests green → update `.claude/docs/active-memory.md` → append ADR if structural.
