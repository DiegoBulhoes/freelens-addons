// The host's `loadAll` never rejects: a failed load leaves an empty store, which every
// count would read as a healthy cluster. These states tell "unknown" from "none".

export interface StoreFacts {
  /** False until Freelens registers the CRD's API. */
  registered: boolean;
  /** Loaded for the current scope by this mount; a refused list also counts as loaded. */
  loaded: boolean;
  /** Refused or unanswered in every namespace in scope. */
  refused: boolean;
  itemCount: number;
  gaveUp: boolean;
}

export type LoadState = "not-installed" | "connecting" | "unreachable" | "ready";

export function loadState(facts: StoreFacts): LoadState {
  if (!facts.registered) return "not-installed";
  if (facts.itemCount > 0) return "ready";

  // With onLoadFailure the host marks a refused list loaded and empty.
  if (facts.refused) return facts.gaveUp ? "unreachable" : "connecting";
  if (facts.loaded) return "ready";

  // Before `gaveUp`: the first attempts routinely fail while the cluster connects.
  if (!facts.gaveUp) return "connecting";

  return "unreachable";
}

const WORST_FIRST: readonly LoadState[] = ["unreachable", "connecting", "not-installed", "ready"];

/** For a page that stands on several lists: ready only when each is. */
export function worstOf(...states: LoadState[]): LoadState {
  return WORST_FIRST.find((state) => states.includes(state)) ?? "ready";
}

/** Loaded for this scope, not only loaded: a shared store keeps the last scope's items until it reloads. */
export function loadedForScope(
  stores: readonly ({ isLoaded: boolean } | undefined)[],
  loadedFor: string | undefined,
  scope: string,
): boolean {
  return loadedFor === scope && stores.every((store) => store?.isLoaded ?? false);
}

/** The list of a cluster-scoped kind, or of a store loaded without namespaces. */
export const EVERYWHERE = "";

/** By kind, the namespaces whose list was refused or never answered. */
export type Failures = ReadonlyMap<string, ReadonlySet<string>>;

export const NO_FAILURES: Failures = new Map();

const NAMED_NAMESPACE = /in the namespace "([^"]+)"/;

function textsOf(error: unknown, depth = 0): string[] {
  if (error === undefined || error === null || depth > 4) return [];

  const message = (error as { message?: unknown }).message;
  const text = typeof message === "string" ? message : String(error);

  return [text, ...textsOf((error as { cause?: unknown }).cause, depth + 1)];
}

/** Kubernetes names the namespace it refused; any other failure counts against all of them. */
export function failedNamespacesOf(error: unknown, namespaces: readonly string[]): string[] {
  if (namespaces.length === 0) return [EVERYWHERE];

  for (const text of textsOf(error)) {
    const named = NAMED_NAMESPACE.exec(text)?.[1];

    if (named !== undefined && namespaces.includes(named)) return [named];
  }

  return [...namespaces];
}

export function addFailure(
  failures: Map<string, Set<string>>,
  kind: string,
  namespaces: readonly string[],
): void {
  const known = failures.get(kind) ?? new Set<string>();

  for (const namespace of namespaces) known.add(namespace);
  failures.set(kind, known);
}

/** A retry of some kinds replaces only their outcome. */
export function settleFailures(
  before: Failures,
  retried: readonly string[],
  after: Failures,
): Failures {
  const settled = new Map(before);

  for (const kind of retried) {
    const failed = after.get(kind);

    if (failed && failed.size > 0) settled.set(kind, failed);
    else settled.delete(kind);
  }

  return settled;
}

export interface PassOutcome {
  /** Watched from now: a watch starts from the list's resource version. */
  subscribe: string[];
  /** Listed again: never loaded, or refused somewhere. */
  retry: string[];
}

/** After one pass over `pending`: a loaded kind is watched at once, without waiting on the others. */
export function afterPass(
  pending: readonly string[],
  isLoaded: (kind: string) => boolean,
  failed: Failures,
): PassOutcome {
  return {
    subscribe: pending.filter(isLoaded),
    retry: pending.filter((kind) => !isLoaded(kind) || (failed.get(kind)?.size ?? 0) > 0),
  };
}

export function refusedEverywhere(
  failures: Failures,
  kind: string,
  namespaces: readonly string[],
): boolean {
  const failed = failures.get(kind);
  const wanted = namespaces.length > 0 ? namespaces : [EVERYWHERE];

  return Boolean(failed) && wanted.every((namespace) => failed?.has(namespace));
}

/** "Could not read Applications in demo; AppProjects in the cluster." for the kinds named. */
export function describeFailures(
  failures: Failures,
  kinds: Readonly<Record<string, string>>,
): string | undefined {
  const parts = Object.entries(kinds).flatMap(([kind, plural]) => {
    const failed = failures.get(kind);

    if (!failed || failed.size === 0) return [];

    const where = [...failed].sort().map((namespace) => namespace || "the cluster");

    return [`${plural} in ${where.join(", ")}`];
  });

  return parts.length > 0
    ? `Could not read ${parts.join("; ")}, so what is below leaves them out.`
    : undefined;
}

export function describeHeadline(
  state: LoadState,
  needingAttention: number,
  total: number,
): string {
  if (state === "not-installed") return "No ArgoCD Applications found";
  if (state === "connecting") return "Looking for ArgoCD…";
  if (state === "unreachable") return "Cannot read the ArgoCD Applications";

  if (total === 0) return "No ArgoCD Applications found";
  if (needingAttention === 0) {
    return total === 1
      ? "The only Application is synced and healthy"
      : `All ${total} Applications are synced and healthy`;
  }

  return `${needingAttention} of ${total} ${total === 1 ? "Application needs" : "Applications need"} attention`;
}

export function describeLoadState(state: LoadState): string | undefined {
  if (state === "not-installed") {
    return "No ArgoCD Applications are registered in this cluster.";
  }

  if (state === "connecting") return "Connecting to the cluster…";

  if (state === "unreachable") {
    return "Could not read the ArgoCD Applications, so what is below may be incomplete.";
  }

  return undefined;
}

/** A list's empty text says nothing is there only once the list is known; the head carries an alarm. */
export function emptyText(
  state: LoadState,
  describe: (state: LoadState) => string | undefined,
  empty: string,
): string {
  if (state === "ready") return empty;
  if (state === "unreachable") return "Nothing could be read, so nothing is listed.";

  return describe(state) ?? empty;
}
