import { useEffect, useState } from "react";

import { AppProject } from "../api/app-project";
import { Application } from "../api/application";
import { getOverviewState, type OverviewState } from "../api/store-state";
import { useKubeStore } from "../components/use-kube-store";

/** 15 x 2s = 30s, which has to outlast a slow cluster connection. */
const MAX_LOAD_ATTEMPTS = 15;
const RETRY_DELAY_MS = 2000;

export interface ArgoCDStores {
  applications: Application[];
  projects: AppProject[];
  /**
   * Whether the lists below mean anything. `loadAll` swallows its failure, so
   * an unreachable cluster leaves an empty store that reads as a healthy one.
   */
  state: OverviewState;
}

export function useArgoCDStores(): ArgoCDStores {
  const applicationStore = useKubeStore(() => Application.getStore<Application>());
  const projectStore = useKubeStore(() => AppProject.getStore<AppProject>());
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!applicationStore || !projectStore) return;

    const stores = [applicationStore, projectStore];
    let attempts = 0;
    setGaveUp(false);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const loadUntilReady = async () => {
      if (cancelled) return;

      // Every pass loads every store, rather than only the ones that have never
      // loaded. These stores are shared with the rest of Freelens, and isLoaded
      // says a list arrived once — not that it was listed under the namespaces
      // in scope now. Trusting it leaves this page showing whatever some other
      // page's first mount happened to fetch, with no way back.
      //
      // loadAll() swallows its failure, so a mount during cluster connect needs
      // the retry below.
      await Promise.all(stores.map((store) => store.loadAll()));

      attempts += 1;

      if (cancelled) return;

      // Retry only while something has still never loaded, which is the cluster
      // still connecting. Once every store has a list, one load per mount is it.
      if (stores.every((store) => store.isLoaded)) return;

      if (attempts >= MAX_LOAD_ATTEMPTS) {
        // The budget is spent; an empty store now means unreachable, not slow.
        setGaveUp(true);

        return;
      }

      retryTimer = setTimeout(() => void loadUntilReady(), RETRY_DELAY_MS);
    };

    void loadUntilReady();

    // subscribe() waits for the namespaces loadAll() sets, so on its own it waits forever.
    const unsubscribers = stores.map((store) => store.subscribe());

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [applicationStore, projectStore]);

  const applications = (applicationStore?.items ?? []) as Application[];

  return {
    applications,
    projects: (projectStore?.items ?? []) as AppProject[],
    state: getOverviewState({
      registered: Boolean(applicationStore),
      loaded: Boolean(applicationStore?.isLoaded),
      failed: Boolean(applicationStore?.failedLoading),
      itemCount: applications.length,
      gaveUp,
    }),
  };
}
