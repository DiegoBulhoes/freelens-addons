import { useEffect, useState } from "react";

/** 15 x 2s = 30s, to outlast a slow cluster connection. */
const MAX_LOAD_ATTEMPTS = 15;
const RETRY_DELAY_MS = 2000;

export interface LoadableStore {
  loadAll(): Promise<unknown>;
  readonly isLoaded: boolean;
  subscribe(): () => void;
}

export interface ScopedLoad {
  gaveUp: boolean;
  /** The scope the stores last finished loading for; isLoaded alone may be another scope's. */
  loadedFor?: string;
}

// Loads on every mount and scope change: the stores are shared with the host, and isLoaded ignores scope.
export function useScopedLoad(stores: (LoadableStore | undefined)[], scope = ""): ScopedLoad {
  const [gaveUp, setGaveUp] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string>();
  const ready = stores.every(Boolean);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the stores themselves are the identity; the array is fresh every render.
  useEffect(() => {
    if (!ready) return;

    const loaded = stores as LoadableStore[];
    let attempts = 0;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribers: (() => void)[] = [];

    setGaveUp(false);
    setLoadedFor(undefined);

    const loadUntilReady = async () => {
      if (cancelled) return;

      // loadAll() swallows its failure, hence the retry.
      await Promise.all(loaded.map((store) => store.loadAll()));
      attempts += 1;

      if (cancelled) return;

      if (loaded.every((store) => store.isLoaded)) {
        // Only now: before the list returns there is no resource version, so no watch opens.
        unsubscribers = loaded.map((store) => store.subscribe());
        setLoadedFor(scope);

        return;
      }

      if (attempts >= MAX_LOAD_ATTEMPTS) {
        setGaveUp(true);

        return;
      }

      retryTimer = setTimeout(() => void loadUntilReady(), RETRY_DELAY_MS);
    };

    void loadUntilReady();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [ready, scope, ...stores]);

  return { gaveUp, loadedFor };
}

export function useLoadedStores(stores: (LoadableStore | undefined)[], scope = ""): boolean {
  return useScopedLoad(stores, scope).gaveUp;
}

interface NamespacedStore {
  loadAll(params?: { namespaces?: string[] }): Promise<unknown>;
  readonly isLoaded: boolean;
  subscribe(): () => void;
}

/** The store loaded for these namespaces rather than the selected ones; undefined with none. */
export function inNamespaces(
  store: NamespacedStore | undefined,
  joined: string,
): LoadableStore | undefined {
  if (!store || !joined) return undefined;

  const namespaces = joined.split(",");

  return {
    loadAll: () => store.loadAll({ namespaces }),
    get isLoaded() {
      return store.isLoaded;
    },
    subscribe: () => store.subscribe(),
  };
}
