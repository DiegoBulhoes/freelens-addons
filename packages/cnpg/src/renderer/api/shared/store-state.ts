import type { Page } from "./navigation";

// `loadAll` never rejects: a failed load leaves an empty store, which would read as "no clusters".

export interface StoreFacts {
  /** False until Freelens registers the CRD's API. */
  registered: boolean;
  /** Loaded for the scope shown, not only once under another. */
  loaded: boolean;
  gaveUp: boolean;
  /** Refused in every namespace in scope: the host then marks the store loaded and empty. */
  refused?: boolean;
}

export type LoadState = "not-installed" | "connecting" | "unreachable" | "ready";

export function loadState(facts: StoreFacts): LoadState {
  if (!facts.registered) return "not-installed";
  if (facts.loaded && !facts.refused) return "ready";
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

/** A list whose CRD may be absent, as ObjectStore without the Barman Cloud plugin: nothing to read. */
export function optional(state: LoadState): LoadState {
  return state === "not-installed" ? "ready" : state;
}

export function describeLoadState(
  state: LoadState,
  what = "the Postgres clusters",
): string | undefined {
  if (state === "not-installed") return "CloudNativePG is not installed in this cluster.";
  if (state === "connecting") return "Connecting to the cluster…";
  if (state === "unreachable") {
    return `Could not read ${what}, so what is below may be incomplete.`;
  }

  return undefined;
}

export interface KindStates {
  clusters: LoadState;
  backups: LoadState;
  schedules: LoadState;
  poolers: LoadState;
  objectStores: LoadState;
  publications: LoadState;
  subscriptions: LoadState;
  pods: LoadState;
  budgets: LoadState;
}

export type Kind = keyof KindStates;

/** By kind, the namespaces whose list was refused or never answered. */
export type Failures = Partial<Record<Kind, ReadonlySet<string>>>;

/** The one list of an empty scope, which the host lists cluster-wide. */
export const EVERYWHERE = "";

const NOUNS: Record<Kind, string> = {
  clusters: "Postgres clusters",
  backups: "Backups",
  schedules: "ScheduledBackups",
  poolers: "Poolers",
  objectStores: "ObjectStores",
  publications: "Publications",
  subscriptions: "Subscriptions",
  pods: "Pods",
  budgets: "PodDisruptionBudgets",
};

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

export function failedEverywhere(
  failed: ReadonlySet<string> | undefined,
  scope: readonly string[],
): boolean {
  if (!failed || failed.size === 0) return false;

  return wantedIn(scope).every((namespace) => failed.has(namespace));
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

/** The scope less namespaces where one of `kinds` was not read; refused everywhere is unreachable instead. */
export function readableScope(
  scope: readonly string[],
  failures: Failures,
  kinds: readonly Kind[],
): string[] {
  const narrowing = kinds.filter((kind) => !failedEverywhere(failures[kind], scope));

  return scope.filter((namespace) => !narrowing.some((kind) => failures[kind]?.has(namespace)));
}

/** "Could not read Backups in staging; Pods in every namespace, so ..." for the kinds named. */
export function describeFailures(failures: Failures, kinds: readonly Kind[]): string | undefined {
  const parts = kinds.flatMap((kind) => {
    const failed = failures[kind];

    if (!failed || failed.size === 0) return [];

    const where = [...failed].sort().map((namespace) => namespace || "every namespace");

    return [`${NOUNS[kind]} in ${where.join(", ")}`];
  });

  return parts.length > 0
    ? `Could not read ${parts.join("; ")}, so those namespaces are left out.`
    : undefined;
}

/** For one object's section, as the cluster drawer's disruption budgets. */
export function kindNote(
  state: LoadState,
  failed: ReadonlySet<string> | undefined,
  namespace: string,
  kind: Kind,
): string | undefined {
  const what = NOUNS[kind];

  return (
    describeLoadState(state, `the ${what}`) ??
    (failed?.has(namespace) || failed?.has(EVERYWHERE)
      ? `Could not read the ${what} in ${namespace}.`
      : undefined)
  );
}

export type StorePage = "overview" | Page;

const OPTIONAL: ReadonlySet<Kind> = new Set(["objectStores", "publications", "subscriptions"]);

/** Each page's state is that of every list its verdicts stand on. */
const PAGES: Record<StorePage, { kinds: Kind[]; what: string }> = {
  overview: {
    kinds: [
      "clusters",
      "backups",
      "schedules",
      "poolers",
      "objectStores",
      "publications",
      "subscriptions",
      "pods",
    ],
    what: "every CloudNativePG list",
  },
  clusters: {
    kinds: ["clusters", "backups", "schedules", "objectStores"],
    what: "the clusters or their backups",
  },
  backups: { kinds: ["backups"], what: "the Backups" },
  schedules: {
    kinds: ["schedules", "clusters", "backups"],
    what: "the schedules, their clusters or their backups",
  },
  poolers: {
    kinds: ["poolers", "clusters", "pods"],
    what: "the poolers, their clusters or their pods",
  },
  logical: { kinds: ["publications", "subscriptions"], what: "the publications or subscriptions" },
};

/** The namespaces a page shows: none while connecting, else those where its lists were read. */
export function shownScope(
  scope: readonly string[],
  failures: Failures,
  page: StorePage,
  state: LoadState,
): string[] {
  // Rows judged by a list still loading would read "No backup" or "Cluster missing".
  if (state === "connecting") return [];

  return readableScope(scope, failures, PAGES[page].kinds);
}

export interface PageLoad {
  state: LoadState;
  note?: string;
  /** Refused, wholly or in some namespaces, rather than still connecting. */
  alarm: boolean;
}

export function pageLoad(states: KindStates, page: StorePage, failures: Failures = {}): PageLoad {
  const { kinds, what } = PAGES[page];
  const state = worstOf(
    ...kinds.map((kind) => (OPTIONAL.has(kind) ? optional(states[kind]) : states[kind])),
  );
  const failed = state === "ready" ? describeFailures(failures, kinds) : undefined;

  return {
    state,
    note: describeLoadState(state, what) ?? failed,
    alarm: state === "unreachable" || failed !== undefined,
  };
}

/** The head carries the alarm, so an empty list read from nothing says only that. */
export function emptyText(load: PageLoad, empty: string): string {
  if (load.state === "unreachable") return "Nothing could be read, so nothing is listed.";

  return load.note ?? empty;
}
