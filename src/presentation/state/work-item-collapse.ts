import { create } from 'zustand';

/**
 * Which rail sections / work items the user has collapsed. Persisted so the rail
 * looks the same after a reload; keys are namespaced (`sec:` / `wi:`) because a
 * section id and a ticket id share this one set.
 */
const KEY = 'hourglass.workItemCollapse';

const sectionKey = (id: string): string => `sec:${id}`;
const itemKey = (id: number): string => `wi:${id}`;

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persist(keys: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...keys]));
  } catch {
    // A full/blocked localStorage costs us persistence, not the session.
  }
}

interface CollapseState {
  collapsed: ReadonlySet<string>;
  toggle: (key: string) => void;
  /** Seed a section's initial state from its `defaultCollapsed` flag, once. */
  seed: (key: string) => void;
  isCollapsed: (key: string) => boolean;
}

export const useWorkItemCollapse = create<CollapseState>((set, get) => ({
  collapsed: load(),
  toggle: (key) =>
    set((s) => {
      const next = new Set(s.collapsed);
      if (!next.delete(key)) next.add(key);
      persist(next);
      return { collapsed: next };
    }),
  seed: (key) =>
    set((s) => {
      if (s.collapsed.has(key)) return s;
      const next = new Set(s.collapsed).add(key);
      persist(next);
      return { collapsed: next };
    }),
  isCollapsed: (key) => get().collapsed.has(key),
}));

export const collapseKeys = { section: sectionKey, item: itemKey };
