import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// The real container-context eagerly boots an async, WASM-SQLite-backed
// Container at module load — unsafe/slow under jsdom. Every component/hook
// test instead resolves `useContainer()` via `renderWithProviders`
// (src/test/render.tsx), which points this mock at a fake `Container`.
vi.mock('@presentation/container-context', () => import('./container-context-mock'));

afterEach(() => {
  cleanup();
});
