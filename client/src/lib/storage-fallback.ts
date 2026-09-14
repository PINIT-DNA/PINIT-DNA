/**
 * Keep the app alive when the browser refuses Web Storage.
 *
 * Some browsers throw on the mere *read* of `window.localStorage` — Chrome with
 * site data blocked, several in-app browsers, locked-down WebViews:
 *
 *   SecurityError: Failed to read the 'localStorage' property from 'Window':
 *   Access is denied for this document.
 *
 * The app touches storage in over a hundred places, many during render, so one
 * denial took down the whole login page. Rather than guard every call site,
 * this swaps in an in-memory Storage before anything else runs. The app then
 * works for that tab; the only cost is that a sign-in does not survive a reload,
 * which is exactly what the browser asked for by blocking storage.
 *
 * Must be the first import in main.tsx.
 */

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

/** True when this storage can actually be read and written. */
function storageWorks(win: Window, name: 'localStorage' | 'sessionStorage'): boolean {
  try {
    const store = win[name];
    const probe = '__pinit_storage_probe__';
    store.setItem(probe, probe);
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace any denied storage with an in-memory one.
 * Returns the names that were replaced, so callers and tests can tell.
 */
export function installStorageFallback(win: Window = window): string[] {
  const replaced: string[] = [];
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (storageWorks(win, name)) continue;
    const memory = new MemoryStorage();
    try {
      Object.defineProperty(win, name, {
        configurable: true,
        enumerable: true,
        get: () => memory,
      });
      replaced.push(name);
    } catch {
      // Nothing more we can do; call sites keep their own try/catch where present.
    }
  }
  if (replaced.length) {
    console.warn(
      `[PINIT] ${replaced.join(' and ')} blocked by this browser — using in-memory storage for this tab.`,
    );
  }
  return replaced;
}

installStorageFallback();
