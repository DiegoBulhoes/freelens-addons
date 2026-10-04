import { useEffect, useState } from "react";

// 15 x 2s = 30s, to outlast a slow cluster connection.
const MAX_LOAD_ATTEMPTS = 15;
const RETRY_DELAY_MS = 2000;

interface LoadableStore {
  loadAll(options: { onLoadFailure: (error: unknown) => void }): Promise<unknown>;
  readonly isLoaded: boolean;
  subscribe(): () => void;
}

// Every pass loads every store: they are shared, and isLoaded says a list arrived once,
// not under the current scope. onLoadFailure stops resetOnError deafening the watches.
export function useLoadedStores(stores: (LoadableStore | undefined)[], scope = ""): boolean {
  const [gaveUp, setGaveUp] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the stores themselves are the identity; the array is fresh every render.
  useEffect(() => {
    const loaded = stores.filter((store): store is LoadableStore => store !== undefined);

    if (loaded.length === 0) return;

    let attempts = 0;
    setGaveUp(false);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let unsubscribers: (() => void)[] = [];

    const loadUntilReady = async () => {
      if (cancelled) return;

      // loadAll() swallows its failure, so a mount during cluster connect needs the retry.
      await Promise.all(
        loaded.map((store) =>
          store.loadAll({
            onLoadFailure: (error: unknown) =>
              console.warn("[cert-manager] could not load a kind", error),
          }),
        ),
      );

      attempts += 1;

      if (cancelled) return;

      // Retry only while something has never loaded: the cluster still connecting.
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
  }, [scope, ...stores]);

  return gaveUp;
}
