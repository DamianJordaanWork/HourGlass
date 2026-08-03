# Workflow: add a feature

Work inside-out so business logic stays pure and testable.

1. **Domain first.** Add/extend entities + value objects in `src/domain/`. If it needs external data, define/extend a **port interface** in `domain/` — never call I/O here. Add pure domain-service logic + Vitest tests.
2. **Application.** Add a use case in `src/application/` that orchestrates domain via ports. Return DTOs; throw domain errors. Unit-test with fake ports.
3. **Infrastructure.** Implement the port in `src/infrastructure/` (SQLite repo / REST client / etc.). Map external shapes ↔ domain. Test the mapping.
4. **Composition.** Register the adapter in `src/composition/` (respect platform: desktop vs web).
5. **Presentation.** Build the React UI in `src/presentation/`. Async via TanStack Query hooks that call use cases; UI state via Zustand. Style with design-system tokens only.
6. **Verify.** `npm run typecheck && npm run test`; manually exercise in `npm run dev`.
7. **Document.** Update `.claude/docs/active-memory.md`; append an ADR if a structural decision was made; keep `standards/` accurate.

Rules of thumb: if you're importing `fetch`/`Tauri`/SQL outside `infrastructure/`, stop. If a component knows a concrete adapter, route it through composition instead.
