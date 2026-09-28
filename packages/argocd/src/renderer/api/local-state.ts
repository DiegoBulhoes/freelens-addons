/**
 * One operator's working state, held in memory, with no idea where it is kept.
 *
 * It used to be in `localStorage`, which loses all of it on every launch.
 * Freelens serves each cluster frame from
 * `https://<clusterId>.renderer.freelens.app:<port>` where the port is whatever
 * the OS handed `proxyServer.listen(0)`, so the origin — and with it the whole
 * storage bucket — is new every start.
 *
 * `persist.ts` loads this from a file when the extension activates and writes
 * it back on change. That file owns the timeout, the write chain and the
 * temp-then-rename, so it is covered like everything else here rather than
 * excluded as a boundary.
 */

let state: Record<string, unknown> = {};
const listeners = new Set<() => void>();

/** Absent reads as "never written", which is what a first run and an unreadable file both are. */
export function readState<T>(key: string, fallback: T): T {
  return key in state ? (state[key] as T) : fallback;
}

/** Values must survive `JSON.stringify`; every caller writes a freshly built array or object. */
export function writeState(key: string, value: unknown): void {
  state[key] = value;

  for (const listener of listeners) listener();
}

/**
 * Replace everything with what was loaded. Anything that is not a plain object
 * leaves the store empty rather than throwing: losing a preference is
 * acceptable, failing a render is not.
 *
 * Deliberately silent, so loading a file does not queue a write of what was
 * just read.
 */
export function hydrate(loaded: unknown): void {
  state =
    typeof loaded === "object" && loaded !== null && !Array.isArray(loaded)
      ? { ...(loaded as Record<string, unknown>) }
      : {};
}

/** A copy, so the boundary cannot hold a reference that changes under it. */
export function snapshot(): Record<string, unknown> {
  return { ...state };
}

export function onStateChange(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
