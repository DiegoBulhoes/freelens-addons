import { readState, writeState } from "./local-state";

const STORAGE_KEY = "freelens-addons.argocd.preferences";

export interface Preferences {
  attentionFilter?: string;
}

export function readPreferences(): Preferences {
  const value = readState<unknown>(STORAGE_KEY, {});

  return value && typeof value === "object" && !Array.isArray(value) ? (value as Preferences) : {};
}

export function writePreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  writeState(STORAGE_KEY, { ...readPreferences(), [key]: value });
}
