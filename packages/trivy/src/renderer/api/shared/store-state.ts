/** A cluster-scoped kind's one list. */
export const EVERYWHERE = "";

/** By kind, the namespaces whose list was refused or never answered. */
export type Failures = ReadonlyMap<string, ReadonlySet<string>>;

export interface LoadedKind {
  kind: string;
  namespaced: boolean;
}

const NAMED_NAMESPACE = /in the namespace "([^"]+)"/;

function textsOf(error: unknown, depth = 0): string[] {
  if (error === undefined || error === null || depth > 4) return [];

  const message = (error as { message?: unknown }).message;
  const text = typeof message === "string" ? message : String(error);

  return [text, ...textsOf((error as { cause?: unknown }).cause, depth + 1)];
}

/** Kubernetes names the namespace a list was refused in; any other failure counts against all of them. */
export function failedNamespacesOf(error: unknown, scope: readonly string[]): string[] {
  for (const text of textsOf(error)) {
    const named = NAMED_NAMESPACE.exec(text)?.[1];

    if (named !== undefined && scope.includes(named)) return [named];
  }

  return [...scope];
}

export function scopeOfKind(kind: LoadedKind, scope: readonly string[]): readonly string[] {
  return kind.namespaced ? scope : [EVERYWHERE];
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
): Map<string, ReadonlySet<string>> {
  const settled = new Map(before);

  for (const kind of retried) {
    const failed = after.get(kind);

    if (failed && failed.size > 0) settled.set(kind, failed);
    else settled.delete(kind);
  }

  return settled;
}

export function failedEverywhere(
  failures: Failures,
  kind: LoadedKind,
  scope: readonly string[],
): boolean {
  const failed = failures.get(kind.kind);
  const wanted = scopeOfKind(kind, scope);

  if (!failed || wanted.length === 0) return false;

  return wanted.every((namespace) => failed.has(namespace));
}

/** The scope less the namespaces where one of `kinds` could not be read: totals over them would read as facts. */
export function readableScope(
  scope: readonly string[],
  failures: Failures,
  kinds: readonly string[],
): string[] {
  return scope.filter((namespace) => !kinds.some((kind) => failures.get(kind)?.has(namespace)));
}

export function unreadIn(failures: Failures, kind: string): ReadonlySet<string> {
  return failures.get(kind) ?? new Set();
}

/** "Could not read Pods in demo; VulnerabilityReports in argocd, demo." for the kinds named. */
export function describeFailures(failures: Failures, kinds: readonly string[]): string | undefined {
  const parts = kinds.flatMap((kind) => {
    const failed = failures.get(kind);

    if (!failed || failed.size === 0) return [];

    const where = [...failed].sort().map((namespace) => namespace || "the cluster");

    return [`${kind}s in ${where.join(", ")}`];
  });

  return parts.length > 0 ? `Could not read ${parts.join("; ")}.` : undefined;
}

export type LoadState = "connecting" | "unreachable" | "ready";

export interface LoadFacts {
  /** This mount's own load landed for the current scope. */
  loaded: boolean;
  gaveUp: boolean;
  failures: Failures;
  /** The kinds a page cannot stand without; a kind refused in every namespace is not ready. */
  required: readonly LoadedKind[];
  scope: readonly string[];
}

export function loadState(facts: LoadFacts): LoadState {
  const blocked =
    !facts.loaded ||
    facts.required.some((kind) => failedEverywhere(facts.failures, kind, facts.scope));

  if (!blocked) return "ready";

  return facts.gaveUp ? "unreachable" : "connecting";
}

/** Loaded for this scope, not only loaded: a shared store keeps the last scope's items until it reloads. */
export function loadedForScope(
  stores: readonly ({ isLoaded: boolean } | undefined)[],
  loadedFor: string | undefined,
  scope: string,
): boolean {
  return loadedFor === scope && stores.every((store) => store?.isLoaded ?? true);
}

/** What could not be read, and what that does to the page; undefined when everything was. */
export function describeGap(
  failures: Failures,
  kinds: readonly string[],
  consequence: string,
): string | undefined {
  const failed = describeFailures(failures, kinds);

  return failed && `${failed} ${consequence}`;
}

export interface PassOutcome {
  /** Kinds whose list landed this pass: each watches now, whatever the others did. */
  watch: string[];
  /** Kinds to list again: unlisted ones, and listed ones that a namespace refused. */
  retry: string[];
  /** Every kind has listed, so the page may count. */
  settled: boolean;
}

export function afterPass(
  pending: readonly { kind: string; isLoaded: boolean }[],
  registered: readonly { kind: string; isLoaded: boolean }[],
  failed: Failures,
): PassOutcome {
  const unlisted = registered.filter((entry) => !entry.isLoaded).map((entry) => entry.kind);
  const refused = pending
    .filter((entry) => entry.isLoaded && failed.has(entry.kind))
    .map((entry) => entry.kind);

  return {
    watch: pending.filter((entry) => entry.isLoaded).map((entry) => entry.kind),
    retry: [...new Set([...unlisted, ...refused])],
    settled: unlisted.length === 0,
  };
}
