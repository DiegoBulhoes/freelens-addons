// `loadAll` never rejects: a failed load leaves an empty store, which would read as "no Redis".

export interface StoreFacts {
  /** False until Freelens registers the CRD's API. */
  registered: boolean;
  loaded: boolean;
  itemCount: number;
  gaveUp: boolean;
  /** Refused in every namespace in scope: the host then marks it loaded and empty. */
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

const wantedIn = (scope: readonly string[]) => (scope.length > 0 ? scope : [EVERYWHERE]);

/** Kubernetes names the namespace a list was refused in; any other failure counts against all of them. */
export function failedNamespacesOf(error: unknown, scope: readonly string[]): string[] {
  const wanted = wantedIn(scope);

  for (const text of textsOf(error)) {
    const named = NAMED_NAMESPACE.exec(text)?.[1];

    if (named !== undefined && wanted.includes(named)) return [named];
  }

  return [...wanted];
}

export function failedEverywhere(failed: ReadonlySet<string>, scope: readonly string[]): boolean {
  return failed.size > 0 && wantedIn(scope).every((namespace) => failed.has(namespace));
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

/** Refused where it matters: a namespace with nothing of ours in it judges nothing. */
export function failedAmong(failed: ReadonlySet<string>, namespaces: readonly string[]): boolean {
  return failed.has(EVERYWHERE) || namespaces.some((namespace) => failed.has(namespace));
}

export type Kind =
  | "Standalones"
  | "Replications"
  | "Clusters"
  | "Sentinels"
  | "Pods"
  | "PersistentVolumeClaims";

/** By kind, the namespaces whose list was refused or never answered. */
export type Failures = Partial<Record<Kind, ReadonlySet<string>>>;

/** "Could not read Pods in apps; Sentinels in every namespace, so ..." */
export function describeFailures(failures: Failures): string | undefined {
  const parts = Object.entries(failures).flatMap(([kind, failed]) => {
    if (!failed || failed.size === 0) return [];

    const where = [...failed].sort().map((namespace) => namespace || "every namespace");

    return [`${kind} in ${where.join(", ")}`];
  });

  return parts.length > 0
    ? `Could not read ${parts.join("; ")}, so nothing there is judged.`
    : undefined;
}

export type StoreLoad = Omit<StoreFacts, "itemCount">;

/** CRDs not installed are left out; the pods and volumes every verdict reads count as much. */
export function inventoryState(crds: StoreLoad[], host: StoreLoad): LoadState {
  const installed = crds.filter((each) => each.registered);

  if (installed.length === 0) return "not-installed";

  return worstOf(...[...installed, host].map((each) => loadState({ ...each, itemCount: 0 })));
}

export function describeLoadState(state: LoadState): string | undefined {
  if (state === "not-installed") return "The redis-operator is not installed in this cluster.";
  if (state === "connecting") return "Connecting to the cluster…";
  if (state === "unreachable") {
    return "Could not read the Redis objects or their pods, so what is below may be incomplete.";
  }

  return undefined;
}

export interface PageNote {
  note?: string;
  /** Refused, wholly or in some namespaces, rather than still connecting. */
  alarm: boolean;
}

/** What a page's subline says of its lists: why it is not ready, else which namespaces refused. */
export function pageNote(state: LoadState, failures: Failures): PageNote {
  const failed = state === "ready" ? describeFailures(failures) : undefined;

  return {
    note: describeLoadState(state) ?? failed,
    alarm: state === "unreachable" || failed !== undefined,
  };
}

/** An empty list says so only once it is read; the head carries the alarm. */
export function emptyText(state: LoadState, empty: string): string {
  if (state === "unreachable") return "Nothing could be read, so nothing is listed.";

  return describeLoadState(state) ?? empty;
}
