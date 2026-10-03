import { useEffect, useState } from "react";

// 30s in total: has to outlast a slow cluster connection.
const MAX_LOAD_ATTEMPTS = 15;
const RETRY_DELAY_MS = 2000;

interface LoadableStore {
  loadAll(options: { onLoadFailure: (error: unknown) => void }): Promise<unknown>;
  readonly isLoaded: boolean;
  subscribe(): () => void;
}

// Loads every store each pass: a shared store's isLoaded may reflect another page's scope.
// onLoadFailure stops the host's resetOnError from emptying a shared store and deafening its watches.
export function useLoadedStores(
  stores: (LoadableStore | undefined)[],
  scope: string,
  what: string,
): boolean {
  const [gaveUp, setGaveUp] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the stores themselves are the identity; the array is fresh every render.
  useEffect(() => {
    const loaded = stores.filter((store) => store !== undefined);

    if (loaded.length === 0) return;

    let attempts = 0;
    setGaveUp(false);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const loadUntilReady = async () => {
      if (cancelled) return;

      await Promise.all(
        loaded.map((store) =>
          store.loadAll({
            onLoadFailure: (error: unknown) =>
              console.warn(`[trivy] could not load ${what}`, error),
          }),
        ),
      );

      attempts += 1;

      // Retry only while something has never loaded.
      if (cancelled || loaded.every((store) => store.isLoaded)) return;

      if (attempts >= MAX_LOAD_ATTEMPTS) {
        setGaveUp(true);

        return;
      }

      retryTimer = setTimeout(() => void loadUntilReady(), RETRY_DELAY_MS);
    };

    void loadUntilReady();

    // subscribe() waits for the namespaces loadAll() sets, so on its own it waits forever.
    const unsubscribers = loaded.map((store) => store.subscribe());

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [scope, what, ...stores]);

  return gaveUp;
}
