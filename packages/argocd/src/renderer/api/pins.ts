import { readState, writeState } from "./local-state";

const STORAGE_KEY = "freelens-addons.argocd.pins";

// Ids are `<namespace>/<name>`, the same identity `idOf` builds for acknowledgements.
export function listPins(): string[] {
  const value = readState<unknown>(STORAGE_KEY, []);

  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is string => typeof entry === "string");
}

export function isPinned(id: string): boolean {
  return listPins().includes(id);
}

export function togglePin(id: string): boolean {
  const pins = listPins();
  const pinned = pins.includes(id);

  writeState(STORAGE_KEY, pinned ? pins.filter((entry) => entry !== id) : [...pins, id]);

  return !pinned;
}
