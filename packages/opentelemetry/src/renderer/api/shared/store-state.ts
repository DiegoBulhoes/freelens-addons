// `loadAll` never rejects: a failed load leaves an empty store, which would read as "nothing opts in".

export interface StoreFacts {
  /** False until Freelens registers the CRD's API. */
  registered: boolean;
  loaded: boolean;
  itemCount: number;
  gaveUp: boolean;
}

export type LoadState = "not-installed" | "connecting" | "unreachable" | "ready";

export function loadState(facts: StoreFacts): LoadState {
  if (!facts.registered) return "not-installed";
  if (facts.loaded || facts.itemCount > 0) return "ready";
  if (!facts.gaveUp) return "connecting";

  return "unreachable";
}

/** Loaded for this scope, not only loaded: a store keeps the last scope's items until it reloads. */
export function loadedForScope(
  stores: { isLoaded: boolean }[],
  loadedFor: string | undefined,
  scope: string,
): boolean {
  return loadedFor === scope && stores.every((store) => store.isLoaded);
}

const WORST_FIRST: readonly LoadState[] = ["unreachable", "connecting", "not-installed", "ready"];

/** For a page that stands on several lists: ready only when each is. */
export function worstOf(...states: LoadState[]): LoadState {
  return WORST_FIRST.find((state) => states.includes(state)) ?? "ready";
}

export function describeLoadState(state: LoadState): string | undefined {
  if (state === "not-installed") {
    return "The OpenTelemetry Operator is not installed in this cluster.";
  }
  if (state === "connecting") return "Connecting to the cluster…";
  if (state === "unreachable") {
    return "Could not read the OpenTelemetry objects, so what is below may be incomplete.";
  }

  return undefined;
}
