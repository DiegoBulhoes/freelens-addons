// `loadAll` never rejects: a failed load leaves an empty store, which would read as "no clusters".

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

export function describeLoadState(state: LoadState): string | undefined {
  if (state === "not-installed")
    return "The MongoDB operator (MCK) is not installed in this cluster.";
  if (state === "connecting") return "Connecting to the cluster…";
  if (state === "unreachable") {
    return "Could not read the clusters, so what is below may be incomplete.";
  }

  return undefined;
}
