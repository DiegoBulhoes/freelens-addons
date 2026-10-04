import { useEffect, useState } from "react";

/** 15 x 2s = 30s, to outlast a slow cluster connection. */
const MAX_LOAD_ATTEMPTS = 15;
const RETRY_DELAY_MS = 2000;

interface LoadableStore {
  loadAll(): Promise<unknown>;
  readonly isLoaded: boolean;
  subscribe(): () => void;
}

/**
 * Loads every store on every mount and scope change: the stores are shared with the host, and
 * isLoaded only says a list arrived once, under whatever scope was current then.
 */
export function useLoadedStores(stores: (LoadableStore | undefined)[], scope = ""): boolean {
  const [gaveUp, setGaveUp] = useState(false);
  const ready = stores.every(Boolean);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the stores themselves are the identity; the array is fresh every render.
  useEffect(() => {
    if (!ready) return;

    const loaded = stores as LoadableStore[];
    let attempts = 0;
    setGaveUp(false);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let unsubscribers: (() => void)[] = [];

    const loadUntilReady = async () => {
      if (cancelled) return;

      // loadAll() swallows its failure, hence the retry.
      await Promise.all(loaded.map((store) => store.loadAll()));

      attempts += 1;

      if (cancelled) return;

      if (loaded.every((store) => store.isLoaded)) {
        // Only now: subscribe() watches from the list's resource version, and before the list
        // returns it has none, so it opens no watch at all and the page never updates.
        unsubscribers = loaded.map((store) => store.subscribe());

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

  return gaveUp;
}
