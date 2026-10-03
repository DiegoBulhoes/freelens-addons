import { conditionOf, isIssuing, isReady } from "./expiry";
import { type IssuerIndex, isIssuerReady, issuerKindOf, resolveIssuer } from "./issuers";
import type {
  AcmeState,
  CertificateLike,
  CertificateRequestLike,
  ChallengeLike,
  ObjectLike,
  OrderLike,
} from "./types";

export type LinkState = "ok" | "pending" | "failed" | "missing";

export type LinkKind =
  | "Issuer"
  | "ClusterIssuer"
  | "Certificate"
  | "CertificateRequest"
  | "Order"
  | "Challenge";

export interface ChainLink {
  kind: LinkKind;
  name: string;
  namespace?: string;
  state: LinkState;
  reason?: string;
}

const REVISION = "cert-manager.io/certificate-revision";

function ownedBy(child: ObjectLike, owner: ObjectLike): boolean {
  const uid = owner.metadata.uid;

  return (child.metadata.ownerReferences ?? []).some((reference) =>
    uid ? reference.uid === uid : reference.name === owner.getName(),
  );
}

function revisionOf(request: CertificateRequestLike): number {
  const value = Number(request.metadata.annotations?.[REVISION]);

  return Number.isFinite(value) ? value : 0;
}

// Old requests are often collected, so the revision annotation is read, not the history.
export function latestRequestOf(
  certificate: CertificateLike,
  requests: CertificateRequestLike[],
): CertificateRequestLike | undefined {
  const own = requests.filter(
    (request) => request.getNs() === certificate.getNs() && ownedBy(request, certificate),
  );

  return own.sort(
    (first, second) =>
      revisionOf(second) - revisionOf(first) ||
      (second.metadata.creationTimestamp ?? "").localeCompare(
        first.metadata.creationTimestamp ?? "",
      ),
  )[0];
}

export function ordersOf(request: CertificateRequestLike, orders: OrderLike[]): OrderLike[] {
  return orders.filter((order) => order.getNs() === request.getNs() && ownedBy(order, request));
}

export function challengesOf(order: OrderLike, challenges: ChallengeLike[]): ChallengeLike[] {
  return challenges.filter(
    (challenge) => challenge.getNs() === order.getNs() && ownedBy(challenge, order),
  );
}

function acmeLinkState(state: AcmeState | undefined): LinkState {
  if (state === "valid") return "ok";
  if (state === "errored" || state === "invalid" || state === "expired") return "failed";

  return "pending";
}

function certificateLink(certificate: CertificateLike): ChainLink {
  const ready = conditionOf(certificate, "Ready");
  const state: LinkState = isReady(certificate)
    ? "ok"
    : isIssuing(certificate)
      ? "pending"
      : "failed";

  return {
    kind: "Certificate",
    name: certificate.getName(),
    namespace: certificate.getNs(),
    state,
    reason: state === "ok" ? undefined : ready?.message,
  };
}

function requestLink(request: CertificateRequestLike): ChainLink {
  const ready = conditionOf(request, "Ready");
  const refused = ["Denied", "InvalidRequest"].find(
    (type) => conditionOf(request, type)?.status === "True",
  );

  let state: LinkState = "pending";

  if (ready?.status === "True") state = "ok";
  else if (refused || ready?.reason === "Failed" || ready?.reason === "Denied") state = "failed";

  return {
    kind: "CertificateRequest",
    name: request.getName(),
    namespace: request.getNs(),
    state,
    reason:
      state === "ok"
        ? undefined
        : ((refused ? conditionOf(request, refused)?.message : undefined) ?? ready?.message),
  };
}

export interface ChainInputs {
  index: IssuerIndex;
  requests: CertificateRequestLike[];
  orders: OrderLike[];
  challenges: ChallengeLike[];
}

export function chainOf(certificate: CertificateLike, inputs: ChainInputs): ChainLink[] {
  const ref = certificate.spec.issuerRef;
  const kind = issuerKindOf(ref);
  const chain: ChainLink[] = [];

  if (kind !== "External") {
    const issuer = resolveIssuer(certificate, inputs.index);
    const namespace = kind === "Issuer" ? certificate.getNs() : undefined;

    if (!issuer) {
      chain.push({
        kind,
        name: ref.name,
        namespace,
        state: "missing",
        reason: `No ${kind} named ${ref.name}${namespace ? ` in ${namespace}` : ""}`,
      });
    } else {
      const ready = conditionOf(issuer, "Ready");

      chain.push({
        kind,
        name: issuer.getName(),
        namespace,
        state: isIssuerReady(issuer) ? "ok" : "failed",
        reason: isIssuerReady(issuer) ? undefined : ready?.message,
      });
    }
  }

  chain.push(certificateLink(certificate));

  const request = latestRequestOf(certificate, inputs.requests);

  if (!request) return chain;

  chain.push(requestLink(request));

  for (const order of ordersOf(request, inputs.orders)) {
    const orderState = acmeLinkState(order.status?.state);

    chain.push({
      kind: "Order",
      name: order.getName(),
      namespace: order.getNs(),
      state: orderState,
      reason: orderState === "ok" ? undefined : order.status?.reason,
    });

    for (const challenge of challengesOf(order, inputs.challenges)) {
      const challengeState = acmeLinkState(challenge.status?.state);

      chain.push({
        kind: "Challenge",
        name: challenge.getName(),
        namespace: challenge.getNs(),
        state: challengeState,
        reason: challengeState === "ok" ? undefined : challenge.status?.reason,
      });
    }
  }

  return chain;
}

// A broken or missing issuer wins even when the request only echoes it;
// otherwise the deepest link that is not fine and says something.
export function explanationOf(chain: ChainLink[]): ChainLink | undefined {
  const issuer = chain.find(
    (link) => (link.kind === "Issuer" || link.kind === "ClusterIssuer") && link.state !== "ok",
  );

  if (issuer) return issuer;

  const troubled = chain.filter((link) => link.state !== "ok");

  return [...troubled].reverse().find((link) => link.reason) ?? troubled.at(-1);
}
