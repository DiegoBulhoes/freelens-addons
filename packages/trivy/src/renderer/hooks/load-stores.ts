import { useEffect, useState } from "react";
import { MAX_LOAD_ATTEMPTS, RETRY_DELAY_MS } from "../api/shared/retry";
import {
  addFailure,
  afterPass,
  type Failures,
  failedNamespacesOf,
  type LoadedKind,
  scopeOfKind,
  settleFailures,
} from "../api/shared/store-state";

interface LoadableStore {
  loadAll(options: {
    namespaces: string[];
    onLoadFailure: (error: unknown) => void;
  }): Promise<unknown>;
  readonly isLoaded: boolean;
  subscribe(): () => void;
}

export interface StoreEntry extends LoadedKind {
  /** Undefined until Freelens registers the kind's API. */
  store?: LoadableStore;
}

export interface LoadedStores {
  gaveUp: boolean;
  /** The scope this mount's own load completed for; undefined until it has. */
  loadedFor?: string;
  failures: Failures;
}

const NO_FAILURES: Failures = new Map();

// With onLoadFailure the host keeps a shared store's watches but marks it loaded even after a refusal.
export function useLoadedStores(entries: StoreEntry[], scope: string): LoadedStores {
  const [gaveUp, setGaveUp] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string>();
  const [failures, setFailures] = useState<Failures>(NO_FAILURES);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the stores themselves are the identity; the array is fresh every render.
  useEffect(() => {
    const registered = entries.filter(
      (entry): entry is StoreEntry & { store: LoadableStore } => entry.store !== undefined,
    );

    if (registered.length === 0) return;

    const namespaces = scope ? scope.split(",") : [];
    let attempts = 0;
    let pending = registered;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const unsubscribers = new Map<string, () => void>();

    setGaveUp(false);
    setFailures(NO_FAILURES);
    // A kind registered late may never have loaded, whatever the scope.
    setLoadedFor(undefined);

    const loadUntilReady = async () => {
      if (cancelled) return;

      const failed = new Map<string, Set<string>>();

      await Promise.all(
        pending.map((entry) =>
          entry.store.loadAll({
            namespaces,
            onLoadFailure: (error: unknown) => {
              console.warn(`[trivy] could not load ${entry.kind}s`, error);
              const where = failedNamespacesOf(error, scopeOfKind(entry, namespaces));

              addFailure(failed, entry.kind, where);
            },
          }),
        ),
      );

      attempts += 1;

      if (cancelled) return;

      const outcome = afterPass(
        pending.map((entry) => ({ kind: entry.kind, isLoaded: entry.store.isLoaded })),
        registered.map((entry) => ({ kind: entry.kind, isLoaded: entry.store.isLoaded })),
        failed,
      );
      const retried = pending.map((entry) => entry.kind);

      // A watch starts from its own list's resource version, so a relisted kind subscribes again.
      for (const entry of pending.filter((each) => outcome.watch.includes(each.kind))) {
        unsubscribers.get(entry.kind)?.();
        unsubscribers.set(entry.kind, entry.store.subscribe());
      }

      setFailures((before) => settleFailures(before, retried, failed));
      if (outcome.settled) setLoadedFor(scope);

      if (outcome.retry.length === 0) return;

      if (attempts >= MAX_LOAD_ATTEMPTS) {
        setGaveUp(true);

        return;
      }

      pending = registered.filter((entry) => outcome.retry.includes(entry.kind));
      retryTimer = setTimeout(() => void loadUntilReady(), RETRY_DELAY_MS);
    };

    void loadUntilReady();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      for (const unsubscribe of unsubscribers.values()) unsubscribe();
    };
  }, [scope, ...entries.map((entry) => entry.store)]);

  return { gaveUp, loadedFor, failures };
}
