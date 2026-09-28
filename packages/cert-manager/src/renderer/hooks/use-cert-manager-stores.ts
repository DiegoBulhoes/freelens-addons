import { useEffect } from "react";

import {
  Certificate,
  CertificateRequest,
  Challenge,
  ClusterIssuer,
  Issuer,
  Order,
} from "../api/kinds";
import type {
  CertificateLike,
  CertificateRequestLike,
  ChallengeLike,
  IssuerLike,
  OrderLike,
} from "../api/types";
import { useKubeStore } from "../components/use-kube-store";

/** 15 x 2s = 30s, which has to outlast a slow cluster connection. */
const MAX_LOAD_ATTEMPTS = 15;
const RETRY_DELAY_MS = 2000;

export interface CertManagerStores {
  certificates: CertificateLike[];
  requests: CertificateRequestLike[];
  issuers: IssuerLike[];
  clusterIssuers: IssuerLike[];
  orders: OrderLike[];
  challenges: ChallengeLike[];
  /** False until the CRDs are registered, which is what "cert-manager is not installed" looks like. */
  isReady: boolean;
  /** True once the Certificate list has arrived. */
  hasLoaded: boolean;
}

/**
 * The six cert-manager stores. Pure store access: every decision about what they
 * hold is made in `api/`, against the same objects the tests build from fixtures.
 */
export function useCertManagerStores(): CertManagerStores {
  const certificateStore = useKubeStore(() => Certificate.getStore<Certificate>());
  const requestStore = useKubeStore(() => CertificateRequest.getStore<CertificateRequest>());
  const issuerStore = useKubeStore(() => Issuer.getStore<Issuer>());
  const clusterIssuerStore = useKubeStore(() => ClusterIssuer.getStore<ClusterIssuer>());
  const orderStore = useKubeStore(() => Order.getStore<Order>());
  const challengeStore = useKubeStore(() => Challenge.getStore<Challenge>());

  useEffect(() => {
    const stores = [
      certificateStore,
      requestStore,
      issuerStore,
      clusterIssuerStore,
      orderStore,
      challengeStore,
    ].filter((store) => store !== undefined);

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
              console.warn("[cert-manager] could not load a kind", error),
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
  }, [certificateStore, requestStore, issuerStore, clusterIssuerStore, orderStore, challengeStore]);

  const items = <T>(store: { items: unknown[] } | undefined) => (store?.items ?? []) as T[];

  return {
    certificates: items<CertificateLike>(certificateStore),
    requests: items<CertificateRequestLike>(requestStore),
    issuers: items<IssuerLike>(issuerStore),
    clusterIssuers: items<IssuerLike>(clusterIssuerStore),
    orders: items<OrderLike>(orderStore),
    challenges: items<ChallengeLike>(challengeStore),
    isReady: Boolean(certificateStore),
    hasLoaded: Boolean(certificateStore?.isLoaded),
  };
}
