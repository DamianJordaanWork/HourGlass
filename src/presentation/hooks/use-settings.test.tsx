import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@domain/settings/settings';
import { makeFakeContainer, renderHookWithProviders, waitFor } from '@test/render';
import { useSaveSettings, useSettings } from './use-settings';

describe('useSettings', () => {
  it('resolves to the container repository data', async () => {
    const container = makeFakeContainer({
      repos: {
        ...makeFakeContainer().repos,
        settings: { get: async () => DEFAULT_SETTINGS, save: vi.fn(async (s) => s) },
      },
    });

    const { result } = renderHookWithProviders(() => useSettings(), { fakeContainer: container });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DEFAULT_SETTINGS);
  });
});

describe('useSaveSettings', () => {
  it('persists via the container and invalidates the settings query', async () => {
    let stored = DEFAULT_SETTINGS;
    const save = vi.fn(async (s: typeof DEFAULT_SETTINGS) => {
      stored = s;
      return s;
    });
    const container = makeFakeContainer({
      repos: {
        ...makeFakeContainer().repos,
        settings: { get: async () => stored, save },
      },
    });

    const { result } = renderHookWithProviders(
      () => ({ settings: useSettings(), save: useSaveSettings() }),
      { fakeContainer: container },
    );

    await waitFor(() => expect(result.current.settings.isSuccess).toBe(true));

    const updated = { ...DEFAULT_SETTINGS, weeklyGoalHours: 32 };
    result.current.save.mutate(updated);

    await waitFor(() => expect(save).toHaveBeenCalledWith(updated));
    // The mutation's onSuccess invalidates ['settings'], so the query refetches
    // from the (now-updated) container and the hook's data reflects the save.
    await waitFor(() => expect(result.current.settings.data).toEqual(updated));
  });
});
