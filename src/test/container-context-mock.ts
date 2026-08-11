import type { ReactNode } from 'react';
import type { Container } from '@composition/container';
import { makeFakeContainer } from './fake-container';

/**
 * Backing store for the `@presentation/container-context` mock registered in
 * `src/test/setup.ts`. The real module eagerly boots an async, WASM-SQLite
 * container at import time (`createContainer()`), which is unsafe/slow in
 * jsdom; every test instead resolves `useContainer()` to whatever fake is
 * currently set here (see `renderWithProviders` in `src/test/render.tsx`).
 */
export const containerRef: { current: Container } = { current: makeFakeContainer() };

/** Mock replacement for the real `ContainerProvider` — just renders children. */
export function ContainerProvider({ children }: { children: ReactNode }): ReactNode {
  return children;
}

/** Mock replacement for the real `useContainer` — reads the current test fake. */
export function useContainer(): Container {
  return containerRef.current;
}
