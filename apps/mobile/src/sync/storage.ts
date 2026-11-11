/** Minimal JSON key-value storage used by the write queue (kept free of native imports). */
export interface KeyValueStore {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** In-memory store for tests. Values are round-tripped through JSON like a real store. */
export function createMemoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    async getJSON<T>(key: string) {
      const raw = data.get(key);
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    async setJSON(key, value) {
      data.set(key, JSON.stringify(value));
    },
    async remove(key) {
      data.delete(key);
    },
  };
}
