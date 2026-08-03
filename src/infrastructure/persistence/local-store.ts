/**
 * Persistent local store used by the repositories in web/dev and inside the
 * Tauri webview. Backed by localStorage when available, else an in-memory Map
 * (tests/node). The domain repo interfaces are unchanged, so a SQLite/Tauri-sql
 * backend can be swapped in later without touching callers.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* access can throw in sandboxed contexts */
  }
  return new MemoryStorage();
}

interface Identifiable {
  readonly id: string;
}

/** A persisted collection of rows keyed by `id`. Returns cloned data. */
export class LocalCollection<T extends Identifiable> {
  private items: T[];

  constructor(
    private readonly key: string,
    private readonly storage: StorageLike = defaultStorage(),
  ) {
    const raw = storage.getItem(key);
    this.items = raw ? (JSON.parse(raw) as T[]) : [];
  }

  all(): T[] {
    return this.items.map((i) => ({ ...i }));
  }

  find(predicate: (item: T) => boolean): T[] {
    return this.items.filter(predicate).map((i) => ({ ...i }));
  }

  get(id: string): T | null {
    const found = this.items.find((i) => i.id === id);
    return found ? { ...found } : null;
  }

  upsert(item: T): void {
    const idx = this.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) this.items[idx] = { ...item };
    else this.items.push({ ...item });
    this.persist();
  }

  upsertMany(items: readonly T[]): void {
    for (const item of items) {
      const idx = this.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) this.items[idx] = { ...item };
      else this.items.push({ ...item });
    }
    this.persist();
  }

  delete(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.persist();
  }

  private persist(): void {
    this.storage.setItem(this.key, JSON.stringify(this.items));
  }
}

/** A persisted single value (e.g. settings). */
export class LocalValue<T> {
  constructor(
    private readonly key: string,
    private readonly fallback: T,
    private readonly storage: StorageLike = defaultStorage(),
  ) {}

  get(): T {
    const raw = this.storage.getItem(this.key);
    return raw ? ({ ...this.fallback, ...(JSON.parse(raw) as Partial<T>) } as T) : this.fallback;
  }

  set(value: T): T {
    this.storage.setItem(this.key, JSON.stringify(value));
    return value;
  }
}
