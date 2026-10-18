import {
  Certificate,
  CertificateRequest,
  Challenge,
  ClusterIssuer,
  Issuer,
  Order,
} from "../api/shared/kinds";
import { scopeKey, withinScope } from "../api/shared/namespace-scope";
import { type LoadState, loadedForScope, loadState, unknownKinds } from "../api/shared/store-state";
import type {
  CertificateLike,
  CertificateRequestLike,
  CertManagerKind,
  ChallengeLike,
  IssuerLike,
  OrderLike,
} from "../api/shared/types";
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
  state: LoadState;
  /** Kinds whose list was refused or timed out; their arrays are empty, not known to be. */
  failed: CertManagerKind[];
  /** The failed ones and those not listed for this scope yet: what names them is unknown, not missing. */
  unknown: CertManagerKind[];
  /** False while the Certificates are failed or not yet listed for this scope: an empty list is not known to be empty. */
  certificatesKnown: boolean;
  gaveUp: boolean;
}

export function useCertManagerStores(): CertManagerStores {
  const certificateStore = useKubeStore(() => Certificate.getStore<Certificate>());
  const requestStore = useKubeStore(() => CertificateRequest.getStore<CertificateRequest>());
  const issuerStore = useKubeStore(() => Issuer.getStore<Issuer>());
  const clusterIssuerStore = useKubeStore(() => ClusterIssuer.getStore<ClusterIssuer>());
  const orderStore = useKubeStore(() => Order.getStore<Order>());
  const challengeStore = useKubeStore(() => Challenge.getStore<Challenge>());

  const scope = useNamespaceScope();

  const key = scopeKey(scope);
  const stores = {
    Certificate: certificateStore,
    CertificateRequest: requestStore,
    Issuer: issuerStore,
    ClusterIssuer: clusterIssuerStore,
    Order: orderStore,
    Challenge: challengeStore,
  };
  const { failed, gaveUp, loadedFor, listedFor } = useLoadedStores<CertManagerKind>(stores, key);
  const registered = Object.values(stores).filter(
    (store): store is NonNullable<typeof store> => store !== undefined,
  );

  // Also narrowed here: a shared store keeps what a wider scope fetched until its next load.
  const inScope = <T extends { getNs(): string | undefined }>(
    store: { items: unknown[] } | undefined,
  ) => withinScope((store?.items ?? []) as T[], scope);

  const unknown = unknownKinds<CertManagerKind>(stores, failed, listedFor, key);

  return {
    certificates: inScope<CertificateLike>(certificateStore),
    requests: inScope<CertificateRequestLike>(requestStore),
    issuers: inScope<IssuerLike>(issuerStore),
    clusterIssuers: inScope<IssuerLike>(clusterIssuerStore),
    orders: inScope<OrderLike>(orderStore),
    challenges: inScope<ChallengeLike>(challengeStore),
    state: loadState({
      registered: Boolean(certificateStore),
      loaded: loadedForScope(registered, loadedFor, key),
      gaveUp,
    }),
    failed,
    unknown,
    certificatesKnown: !unknown.includes("Certificate"),
    gaveUp,
  };
}
