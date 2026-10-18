import { useEffect, useState } from "react";

import { afterLoad, failedNamespacesOf } from "../api/shared/store-state";

const RETRY_DELAY_MS = 2000;

interface LoadableStore {
  loadAll(options: {
    namespaces?: string[];
    onLoadFailure: (error: unknown) => void;
  }): Promise<unknown>;
  readonly isLoaded: boolean;
  subscribe(): () => void;
}

export interface LoadedStore {
  gaveUp: boolean;
  /** The scope this mount's own load completed for; undefined until it has. */
  loadedFor?: string;
  /** The namespaces whose last list was refused or never answered. */
  failed: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Loads the store on every mount and scope change: stores are shared with the host, and
 * isLoaded only says a list arrived once, under whatever scope was current then.
 */
export function useLoadedStore(
  store: LoadableStore | undefined,
  scope: string,
  kind: string,
): LoadedStore {
  const [gaveUp, setGaveUp] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string>();
  const [failed, setFailed] = useState<ReadonlySet<string>>(NONE);

  // biome-ignore lint/correctness/useExhaustiveDependencies: kind only names the store in a warning.
  useEffect(() => {
    if (!store) return;

    const namespaces = scope ? scope.split(",") : [];
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    setGaveUp(false);
    setFailed(NONE);
    setLoadedFor(undefined);

    const loadUntilReady = async () => {
      if (cancelled) return;

      const refused = new Set<string>();

      // Without onLoadFailure one refused namespace makes the host empty the shared store.
      await store.loadAll({
        namespaces: namespaces.length > 0 ? namespaces : undefined,
        onLoadFailure: (error: unknown) => {
          console.warn(`[redis] could not list ${kind}`, error);
          for (const namespace of failedNamespacesOf(error, namespaces)) refused.add(namespace);
        },
      });

      attempts += 1;

      if (cancelled) return;

      if (store.isLoaded) {
        // Only now: a watch starts from the list's resource version, so a re-list subscribes again.
        unsubscribe?.();
        unsubscribe = store.subscribe();
        setFailed(refused);
        setLoadedFor(scope);
      }

      const next = afterLoad({ loaded: store.isLoaded, failed: refused.size, attempts });

      if (next === "done") return;
      if (next === "give-up") {
        setGaveUp(true);

        return;
      }

      retryTimer = setTimeout(() => void loadUntilReady(), RETRY_DELAY_MS);
    };

    void loadUntilReady();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe?.();
    };
  }, [store, scope]);

  return { gaveUp, loadedFor, failed };
}
