import {
  Certificate,
  CertificateRequest,
  Challenge,
  ClusterIssuer,
  Issuer,
  Order,
} from "../api/kinds";
import { scopeKey, withinScope } from "../api/namespace-scope";
import type {
  CertificateLike,
  CertificateRequestLike,
  ChallengeLike,
  IssuerLike,
  OrderLike,
} from "../api/types";
import { useKubeStore } from "../components/use-kube-store";
import { useLoadedStores } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface CertManagerStores {
  certificates: CertificateLike[];
  requests: CertificateRequestLike[];
  issuers: IssuerLike[];
  clusterIssuers: IssuerLike[];
  orders: OrderLike[];
  challenges: ChallengeLike[];
  isReady: boolean;
  hasLoaded: boolean;
}

export function useCertManagerStores(): CertManagerStores {
  const certificateStore = useKubeStore(() => Certificate.getStore<Certificate>());
  const requestStore = useKubeStore(() => CertificateRequest.getStore<CertificateRequest>());
  const issuerStore = useKubeStore(() => Issuer.getStore<Issuer>());
  const clusterIssuerStore = useKubeStore(() => ClusterIssuer.getStore<ClusterIssuer>());
  const orderStore = useKubeStore(() => Order.getStore<Order>());
  const challengeStore = useKubeStore(() => Challenge.getStore<Challenge>());

  const scope = useNamespaceScope();

  useLoadedStores(
    [certificateStore, requestStore, issuerStore, clusterIssuerStore, orderStore, challengeStore],
    scopeKey(scope),
  );

  // Also narrowed here: a shared store keeps what a wider scope fetched until its next load.
  const items = <T extends { getNs(): string | undefined }>(
    store: { items: unknown[] } | undefined,
  ) => withinScope((store?.items ?? []) as T[], scope);

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
