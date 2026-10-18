// In memory; `persist.ts` loads and saves it. Not localStorage: the frame's origin port changes every launch.

let state: Record<string, unknown> = {};
const listeners = new Set<() => void>();

export function readState<T>(key: string, fallback: T): T {
  return key in state ? (state[key] as T) : fallback;
}

/** Values must survive `JSON.stringify`. */
export function writeState(key: string, value: unknown): void {
  state[key] = value;

  for (const listener of listeners) listener();
}

/** Non-object input leaves the store empty instead of throwing. Silent, so loading does not queue a write. */
export function hydrate(loaded: unknown): void {
  state =
    typeof loaded === "object" && loaded !== null && !Array.isArray(loaded)
      ? { ...(loaded as Record<string, unknown>) }
      : {};
}

export function snapshot(): Record<string, unknown> {
  return { ...state };
}

export function onStateChange(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
