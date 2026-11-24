/**
 * Safari 12-safe localStorage helpers (swallows quota / private-browsing / JSON errors).
 */

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (_err) {
    // Ignore quota/storage errors in restricted Safari modes
  }
}

export function readStorageJSON<T>(key: string): T | null {
  var raw = readStorage(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (_err) {
    return null;
  }
}

export function writeStorageJSON(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_err) {
    // Ignore quota/storage errors
  }
}

export function removeStorageKeys(keys: string[]): void {
  try {
    for (var i = 0; i < keys.length; i++) {
      window.localStorage.removeItem(keys[i]);
    }
  } catch (_err) {
    // Ignore storage errors
  }
}
