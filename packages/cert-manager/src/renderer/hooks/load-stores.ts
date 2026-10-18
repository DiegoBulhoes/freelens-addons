import { useEffect, useState } from "react";

import { failedAfterList, nextLoadStep } from "../api/shared/store-state";

const TICK_MS = 2000;

interface LoadableStore {
  loadAll(options: { onLoadFailure: (error: unknown) => void }): Promise<unknown>;
  readonly isLoaded: boolean;
  subscribe(): () => void;
}

export interface LoadedStores<K extends string> {
  gaveUp: boolean;
  /** Kinds whose last list was refused or timed out: their stores read loaded and empty. */
  failed: K[];
  /** The scope this mount's own load completed for; undefined until it has. */
  loadedFor?: string;
  /** The scope each kind's own list completed for under this mount. */
  listedFor: Partial<Record<K, string>>;
}

// Lists on every mount, since isLoaded ignores scope; onLoadFailure keeps the watches alive.
export function useLoadedStores<K extends string>(
  stores: Partial<Record<K, LoadableStore | undefined>>,
  scope = "",
): LoadedStores<K> {
  const [gaveUp, setGaveUp] = useState(false);
  const [failed, setFailed] = useState<K[]>([]);
  const [loadedFor, setLoadedFor] = useState<string>();
  const [listedFor, setListedFor] = useState<Partial<Record<K, string>>>({});
  const entries = (Object.entries(stores) as [K, LoadableStore | undefined][]).filter(
    (entry): entry is [K, LoadableStore] => entry[1] !== undefined,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the stores themselves are the identity; the record is fresh every render.
  useEffect(() => {
    if (entries.length === 0) return;

    const kinds = entries.map(([kind]) => kind);
    const listed = new Set<K>();
    const inFlight = new Set<K>();
    let refused: ReadonlySet<K> = new Set<K>();
    const unsubscribers: (() => void)[] = [];
    let attempts = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    setGaveUp(false);
    setFailed([]);
    setLoadedFor(undefined);
    setListedFor({});

    const list = async (kind: K, store: LoadableStore) => {
      let refusedNow = false;
      const refuse = (error: unknown) => {
        refusedNow = true;
        console.warn(`[cert-manager] could not list ${kind}`, error);
      };

      inFlight.add(kind);
      try {
        await store.loadAll({ onLoadFailure: refuse });
      } catch (error) {
        refuse(error);
      }
      inFlight.delete(kind);

      if (cancelled) return;

      const after = failedAfterList(kinds, refused, kind, refusedNow);

      refused = after.refused;
      setFailed(after.failed);

      // loadAll() swallows its failure, so a mount during cluster connect needs the retry.
      if (!store.isLoaded) return;

      listed.add(kind);
      setListedFor((previous) => ({ ...previous, [kind]: scope }));
      // Each as it lists: subscribe() watches from the list's resource version, and has none before.
      unsubscribers.push(store.subscribe());

      if (nextLoadStep(kinds, { listed, inFlight, attempts }).done) {
        if (timer) clearTimeout(timer);
        setGaveUp(false);
        setLoadedFor(scope);
      }
    };

    const tick = () => {
      if (cancelled) return;

      const step = nextLoadStep(kinds, { listed, inFlight, attempts });

      if (step.done) return;
      if (step.gaveUp) {
        setGaveUp(true);

        return;
      }

      attempts += 1;
      for (const [kind, store] of entries) {
        if (step.load.includes(kind)) void list(kind, store);
      }
      timer = setTimeout(tick, TICK_MS);
    };

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [scope, ...Object.values(stores)]);

  return { gaveUp, failed, loadedFor, listedFor };
}
