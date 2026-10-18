// `loadAll` never rejects: a failed load leaves an empty store, which would read as "no clusters".

export interface StoreFacts {
  /** False until Freelens registers the CRD's API. */
  registered: boolean;
  loaded: boolean;
  itemCount: number;
  gaveUp: boolean;
  /** Refused in some namespace: the host marks it loaded, without that namespace's items. */
  failed?: boolean;
}

export type LoadState = "not-installed" | "connecting" | "unreachable" | "ready";

export function loadState(facts: StoreFacts): LoadState {
  if (!facts.registered) return "not-installed";
  if (facts.failed) return "unreachable";
  if (facts.loaded || facts.itemCount > 0) return "ready";
  if (!facts.gaveUp) return "connecting";

  return "unreachable";
}

const WORST_FIRST: readonly LoadState[] = ["unreachable", "connecting", "not-installed", "ready"];

/** For a page that stands on several lists: ready only when each is. */
export function worstOf(...states: LoadState[]): LoadState {
  return WORST_FIRST.find((state) => states.includes(state)) ?? "ready";
}

/** The clusters and the pods every verdict reads; without the CRD there is nothing else to say. */
export function inventoryState(replicaSets: LoadState, pods: LoadState): LoadState {
  return replicaSets === "not-installed" ? replicaSets : worstOf(replicaSets, pods);
}

/** Loaded for this scope, not only loaded: a store keeps the last scope's items until it reloads. */
export function loadedForScope(
  stores: { isLoaded: boolean }[],
  loadedFor: string | undefined,
  scope: string,
): boolean {
  return loadedFor === scope && stores.every((store) => store.isLoaded);
}

/** The one list of an empty scope, which the host lists cluster-wide. */
export const EVERYWHERE = "";

const NAMED_NAMESPACE = /in the namespace "([^"]+)"/;

function textsOf(error: unknown, depth = 0): string[] {
  if (error === undefined || error === null || depth > 4) return [];

  const message = (error as { message?: unknown }).message;
  const text = typeof message === "string" ? message : String(error);

  return [text, ...textsOf((error as { cause?: unknown }).cause, depth + 1)];
}

/** Kubernetes names the namespace a list was refused in; any other failure counts against all of them. */
export function failedNamespacesOf(error: unknown, scope: readonly string[]): string[] {
  const wanted = scope.length > 0 ? scope : [EVERYWHERE];

  for (const text of textsOf(error)) {
    const named = NAMED_NAMESPACE.exec(text)?.[1];

    if (named !== undefined && wanted.includes(named)) return [named];
  }

  return [...wanted];
}

export const MAX_LOAD_ATTEMPTS = 15;

/** After a list: a namespace refused is listed again, until the attempts run out. */
export function afterLoad(outcome: {
  loaded: boolean;
  failed: number;
  attempts: number;
}): "done" | "retry" | "give-up" {
  if (outcome.loaded && outcome.failed === 0) return "done";

  return outcome.attempts >= MAX_LOAD_ATTEMPTS ? "give-up" : "retry";
}

/** Whether the member verdicts can stand on the pods: an empty store before its read is not "no pods". */
export type PodsRead = "reading" | "refused" | "read";

export function podsReadOf(loaded: boolean, gaveUp: boolean): PodsRead {
  if (loaded) return "read";

  return gaveUp ? "refused" : "reading";
}

/** A namespace whose pods were refused has none in the store, which is not a cluster without pods. */
export function podsReadIn(
  read: PodsRead,
  failed: ReadonlySet<string> | undefined,
  namespace: string | undefined,
): PodsRead {
  if (read !== "read") return read;

  return failed && failedAmong(failed, [namespace ?? ""]) ? "refused" : "read";
}

/** Refused where it matters: a namespace with no cluster in it judges nothing. */
export function failedAmong(failed: ReadonlySet<string>, namespaces: readonly string[]): boolean {
  return failed.has(EVERYWHERE) || namespaces.some((namespace) => failed.has(namespace));
}

export function describeLoadState(state: LoadState): string | undefined {
  if (state === "not-installed")
    return "The MongoDB operator (MCK) is not installed in this cluster.";
  if (state === "connecting") return "Connecting to the cluster…";
  if (state === "unreachable") {
    return "Could not read the clusters or their pods, so what is below may be incomplete.";
  }

  return undefined;
}

/** An empty list says so only once it is read; the head carries the alarm. */
export function emptyText(state: LoadState, empty: string): string {
  if (state === "unreachable") return "Nothing could be read, so nothing is listed.";

  return describeLoadState(state) ?? empty;
}
