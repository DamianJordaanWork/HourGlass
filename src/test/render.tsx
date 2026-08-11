import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  renderHook as rtlRenderHook,
  type RenderOptions,
  type RenderHookOptions,
} from '@testing-library/react';
import { ContainerProvider } from '@presentation/container-context';
import type { Container } from '@composition/container';
import { containerRef } from './container-context-mock';
import { makeFakeContainer } from './fake-container';

export { makeFakeContainer } from './fake-container';

/** Fresh `QueryClient` per call — no retries, no cross-test cache carryover. */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Named `fakeContainer` (not `container`) to avoid clashing with RTL's own `container` DOM option. */
  fakeContainer?: Container;
  queryClient?: QueryClient;
}

/**
 * Wraps `ui` in a `QueryClientProvider` + `ContainerProvider` for component
 * tests. `@presentation/container-context` is globally mocked in
 * `src/test/setup.ts` (the real module boots an async WASM-SQLite container at
 * import time, which is unsafe in jsdom); this sets the fake `Container` that
 * mock resolves to before rendering, so every `useContainer()` call anywhere
 * in the tree — including inside hooks like `useTracking`/`useSettings` —
 * sees the same fake, deterministic instance.
 */
export function renderWithProviders(
  ui: ReactElement,
  { fakeContainer = makeFakeContainer(), queryClient = makeTestQueryClient(), ...options }: RenderWithProvidersOptions = {},
) {
  containerRef.current = fakeContainer;

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ContainerProvider>{ui}</ContainerProvider>
    </QueryClientProvider>,
    options,
  );

  return { queryClient, fakeContainer, ...utils };
}

export interface RenderHookWithProvidersOptions<Props> extends Omit<RenderHookOptions<Props>, 'wrapper'> {
  fakeContainer?: Container;
  queryClient?: QueryClient;
}

/** `renderHook` variant wired up with the same fake-container + query-client providers. */
export function renderHookWithProviders<Result, Props>(
  hook: (props: Props) => Result,
  {
    fakeContainer = makeFakeContainer(),
    queryClient = makeTestQueryClient(),
    ...options
  }: RenderHookWithProvidersOptions<Props> = {},
) {
  containerRef.current = fakeContainer;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ContainerProvider>{children}</ContainerProvider>
      </QueryClientProvider>
    );
  }

  const utils = rtlRenderHook(hook, { wrapper: Wrapper, ...options });
  return { queryClient, fakeContainer, ...utils };
}

export { screen, waitFor, within, fireEvent, act } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
