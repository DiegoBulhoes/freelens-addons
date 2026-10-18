export type LoadState = "not-installed" | "connecting" | "unreachable" | "ready";

export interface StoreFacts {
  /** False until Freelens registers the Certificate CRD's API. */
  registered: boolean;
  /** Every store listed for the current scope by this mount's own load. */
  loaded: boolean;
  gaveUp: boolean;
}

export function loadState(facts: StoreFacts): LoadState {
  if (!facts.registered) return "not-installed";
  if (facts.loaded) return "ready";

  return facts.gaveUp ? "unreachable" : "connecting";
}

/** Loaded for this scope, not only loaded: a store keeps the last scope's items until it reloads. */
export function loadedForScope(
  stores: readonly { isLoaded: boolean }[],
  loadedFor: string | undefined,
  scope: string,
): boolean {
  return loadedFor === scope && stores.every((store) => store.isLoaded);
}

/** Kinds whose items are not known for this scope: refused, unregistered or not listed yet. */
export function unknownKinds<K extends string>(
  stores: Record<K, { isLoaded: boolean } | undefined>,
  failed: readonly K[],
  listedFor: Partial<Record<K, string>>,
  scope: string,
): K[] {
  return (Object.keys(stores) as K[]).filter((kind) => {
    const store = stores[kind];

    return failed.includes(kind) || !store || !loadedForScope([store], listedFor[kind], scope);
  });
}

/** Kinds whose latest list was refused, in `kinds` order: a later list that answers clears one. */
export function failedAfterList<K extends string>(
  kinds: readonly K[],
  refused: ReadonlySet<K>,
  kind: K,
  refusedNow: boolean,
): { refused: Set<K>; failed: K[] } {
  const next = new Set(refused);

  if (refusedNow) next.add(kind);
  else next.delete(kind);

  return { refused: next, failed: kinds.filter((each) => next.has(each)) };
}

export function describeLoadState(state: LoadState): string | undefined {
  if (state === "not-installed") {
    return "Waiting for cert-manager's CRDs. If cert-manager is not installed here, there is nothing to list.";
  }
  if (state === "connecting") return "Connecting to the cluster…";
  if (state === "unreachable") {
    return "cert-manager's objects did not load, so nothing here can be judged yet.";
  }

  return undefined;
}

/** Rows only once they are this scope's: until then a shared store may hold another's. */
export function rowsFor<Row>(state: LoadState, rows: Row[]): Row[] {
  return state === "connecting" ? [] : rows;
}

const WORST_FIRST: readonly LoadState[] = ["unreachable", "connecting", "not-installed", "ready"];

/** For a page that stands on several lists: ready only when each is. */
export function worstOf(...states: LoadState[]): LoadState {
  return WORST_FIRST.find((state) => states.includes(state)) ?? "ready";
}

/** 15 x 2s = 30s, to outlast a slow cluster connection. */
export const MAX_LOAD_ATTEMPTS = 15;

export interface LoadProgress<K extends string> {
  /** Listed by this mount for this scope, and watched since. */
  listed: ReadonlySet<K>;
  /** Asked for and not answered yet: asking again would only stack a second list. */
  inFlight: ReadonlySet<K>;
  /** Ticks so far, answered or not, so a hung list still runs the clock out. */
  attempts: number;
}

export interface LoadStep<K extends string> {
  load: K[];
  done: boolean;
  gaveUp: boolean;
}

/** What one tick of the loader does: only the kinds not listed yet are listed again. */
export function nextLoadStep<K extends string>(
  kinds: readonly K[],
  progress: LoadProgress<K>,
  maxAttempts = MAX_LOAD_ATTEMPTS,
): LoadStep<K> {
  const done = kinds.every((kind) => progress.listed.has(kind));
  const gaveUp = !done && progress.attempts >= maxAttempts;

  return {
    done,
    gaveUp,
    load:
      done || gaveUp
        ? []
        : kinds.filter((kind) => !progress.listed.has(kind) && !progress.inFlight.has(kind)),
  };
}
