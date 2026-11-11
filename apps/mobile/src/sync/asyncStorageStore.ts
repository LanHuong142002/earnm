import AsyncStorage from "@react-native-async-storage/async-storage";

import type { KeyValueStore } from "./storage";

/** The app's real store, backed by AsyncStorage. Unparseable values read as null. */
export const asyncStorageStore: KeyValueStore = {
  async getJSON<T>(key: string) {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async setJSON(key, value) {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async remove(key) {
    await AsyncStorage.removeItem(key);
  },
};
