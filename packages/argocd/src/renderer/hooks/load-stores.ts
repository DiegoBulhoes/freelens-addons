import { useEffect, useState } from "react";

import {
  addFailure,
  afterPass,
  type Failures,
  failedNamespacesOf,
  NO_FAILURES,
  settleFailures,
} from "../api/shared/store-state";

/** 15 x 2s = 30s, to outlast a slow cluster connection. */
const MAX_LOAD_ATTEMPTS = 15;
const RETRY_DELAY_MS = 2000;

export interface LoadableStore {
  loadAll(options: {
    namespaces?: string[];
    onLoadFailure: (error: unknown) => void;
  }): Promise<unknown>;
  readonly isLoaded: boolean;
  subscribe(): () => void;
}

export interface StoreEntry {
  kind: string;
  /** Undefined until Freelens registers the kind's API. */
  store?: LoadableStore;
}

export interface LoadedStores {
  gaveUp: boolean;
  /** The scope this mount's own load completed for; undefined until it has. */
  loadedFor?: string;
  failures: Failures;
}

/** Loads on every mount and scope change, since isLoaded ignores scope; onLoadFailure stops one refused namespace emptying the shared store. */
export function useLoadedStores(entries: StoreEntry[], scope = ""): LoadedStores {
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
    const byKind = new Map(registered.map((entry) => [entry.kind, entry.store]));
    let attempts = 0;
    let pending = registered.map((entry) => entry.kind);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const unsubscribers = new Map<string, () => void>();

    setGaveUp(false);
    setFailures(NO_FAILURES);
    setLoadedFor(undefined);

    const loadUntilReady = async () => {
      if (cancelled) return;

      const failed = new Map<string, Set<string>>();

      await Promise.all(
        pending.map((kind) =>
          byKind.get(kind)?.loadAll({
            ...(namespaces.length > 0 ? { namespaces } : {}),
            onLoadFailure: (error: unknown) => {
              console.warn(`[argocd] could not list ${kind}s`, error);
              addFailure(failed, kind, failedNamespacesOf(error, namespaces));
            },
          }),
        ),
      );

      attempts += 1;

      if (cancelled) return;

      const { subscribe, retry } = afterPass(
        pending,
        (kind) => Boolean(byKind.get(kind)?.isLoaded),
        failed,
      );

      for (const kind of subscribe) {
        unsubscribers.get(kind)?.();
        const store = byKind.get(kind);

        if (store) unsubscribers.set(kind, store.subscribe());
      }

      const retried = pending;

      setFailures((before) => settleFailures(before, retried, failed));
      if (registered.every((entry) => entry.store.isLoaded)) setLoadedFor(scope);

      if (retry.length === 0) return;

      if (attempts >= MAX_LOAD_ATTEMPTS) {
        setGaveUp(true);

        return;
      }

      pending = retry;
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
