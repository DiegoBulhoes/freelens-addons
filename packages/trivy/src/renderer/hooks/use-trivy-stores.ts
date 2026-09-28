import { useEffect } from "react";

import {
  ConfigAuditReport,
  ExposedSecretReport,
  SbomReport,
  VulnerabilityReport,
} from "../api/reports";
import { useKubeStore } from "../components/use-kube-store";

/** 15 x 2s = 30s, which has to outlast a slow cluster connection. */
const MAX_LOAD_ATTEMPTS = 15;
const RETRY_DELAY_MS = 2000;

export interface TrivyStores {
  vulnerabilityReports: VulnerabilityReport[];
  configAuditReports: ConfigAuditReport[];
  sbomReports: SbomReport[];
  exposedSecretReports: ExposedSecretReport[];
  /** False until the CRDs are registered, which is what "no Trivy operator here" looks like. */
  isReady: boolean;
  /** True once a load has been attempted and no store reported a failure. */
  hasLoaded: boolean;
}

export function useTrivyStores(): TrivyStores {
  const vulnerabilityStore = useKubeStore(() =>
    VulnerabilityReport.getStore<VulnerabilityReport>(),
  );
  const configAuditStore = useKubeStore(() => ConfigAuditReport.getStore<ConfigAuditReport>());
  const sbomStore = useKubeStore(() => SbomReport.getStore<SbomReport>());
  const exposedSecretStore = useKubeStore(() =>
    ExposedSecretReport.getStore<ExposedSecretReport>(),
  );

  useEffect(() => {
    const stores = [vulnerabilityStore, configAuditStore, sbomStore, exposedSecretStore].filter(
      (store) => store !== undefined,
    );

    if (stores.length === 0) return;

    let attempts = 0;
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
      // onLoadFailure keeps a refused namespace from emptying a store the rest
      // of Freelens shares; without it the host's loadAll calls resetOnError,
      // which also sets isLoaded false and leaves every watch deaf.
      await Promise.all(
        stores.map((store) =>
          store.loadAll({
            onLoadFailure: (error: unknown) =>
              console.warn("[trivy] could not load a report kind", error),
          }),
        ),
      );

      attempts += 1;

      // Retry only while something has still never loaded, which is the cluster
      // still connecting. Once every store has a list, one load per mount is it.
      if (cancelled || stores.every((store) => store.isLoaded)) return;

      if (attempts >= MAX_LOAD_ATTEMPTS) return;

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
  }, [vulnerabilityStore, configAuditStore, sbomStore, exposedSecretStore]);

  return {
    vulnerabilityReports: (vulnerabilityStore?.items ?? []) as VulnerabilityReport[],
    configAuditReports: (configAuditStore?.items ?? []) as ConfigAuditReport[],
    sbomReports: (sbomStore?.items ?? []) as SbomReport[],
    exposedSecretReports: (exposedSecretStore?.items ?? []) as ExposedSecretReport[],
    isReady: Boolean(vulnerabilityStore),
    hasLoaded: Boolean(vulnerabilityStore?.isLoaded && sbomStore?.isLoaded),
  };
}
