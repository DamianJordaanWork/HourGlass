import { create } from 'zustand';

export type ThemePref = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'hourglass.theme';

function apply(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

function initial(): ThemePref {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemePref | null;
  return stored ?? 'system';
}

interface ThemeState {
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
  cycle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  pref: initial(),
  setPref: (pref) => {
    apply(pref);
    localStorage.setItem(STORAGE_KEY, pref);
    set({ pref });
  },
  cycle: () => {
    const order: ThemePref[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(get().pref) + 1) % order.length]!;
    get().setPref(next);
  },
}));

/** Apply the persisted theme before React renders to avoid a flash. */
export function bootstrapTheme(): void {
  apply(initial());
}
