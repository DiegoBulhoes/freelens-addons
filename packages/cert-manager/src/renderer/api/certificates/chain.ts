import {
  type IssuerIndex,
  isIssuerReady,
  issuerIndexOf,
  issuerKindOf,
  issuerNamespace,
  resolveIssuer,
} from "../issuers/issuers";
import { AWAITING_APPROVAL, isAwaitingApproval, revisionOfRequest } from "../requests/requests";
import type {
  AcmeState,
  CertificateLike,
  CertificateRequestLike,
  CertManagerKind,
  ChallengeLike,
  IssuerLike,
  ObjectLike,
  OrderLike,
} from "../shared/types";
import { conditionOf, isIssuing, isReady } from "./expiry";

export type LinkState = "ok" | "pending" | "failed" | "missing" | "unknown";

export interface ChainLink {
  kind: CertManagerKind;
  name: string;
  namespace?: string;
  state: LinkState;
  reason?: string;
}

const childIndexes = new WeakMap<ObjectLike[], Map<string, ObjectLike[]>>();

function ownerKey(namespace: string | undefined, by: "uid" | "name", value: string): string {
  return `${namespace ?? ""}/${by}/${value}`;
}

// Indexed once per list by owner uid and name; the pages pass a fresh list every render.
function childrenOf<T extends ObjectLike>(owner: ObjectLike, children: T[]): T[] {
  let index = childIndexes.get(children);

  if (!index) {
    index = new Map();

    for (const child of children) {
      const keys = new Set<string>();

      for (const reference of child.metadata.ownerReferences ?? []) {
        if (reference.uid) keys.add(ownerKey(child.getNs(), "uid", reference.uid));
        if (reference.name) keys.add(ownerKey(child.getNs(), "name", reference.name));
      }

      for (const key of keys) {
        const siblings = index.get(key);

        if (siblings) siblings.push(child);
        else index.set(key, [child]);
      }
    }

    childIndexes.set(children, index);
  }

  const uid = owner.metadata.uid;
  const key = uid
    ? ownerKey(owner.getNs(), "uid", uid)
    : ownerKey(owner.getNs(), "name", owner.getName());

  return [...((index.get(key) as T[] | undefined) ?? [])];
}

function finiteRevisionOf(request: CertificateRequestLike): number {
  const value = revisionOfRequest(request);

  return Number.isFinite(value) ? value : 0;
}

// Old requests are often collected, so the revision annotation is read, not the history.
export function latestRequestOf(
  certificate: CertificateLike,
  requests: CertificateRequestLike[],
): CertificateRequestLike | undefined {
  return childrenOf(certificate, requests).sort(
    (first, second) =>
      finiteRevisionOf(second) - finiteRevisionOf(first) ||
      (second.metadata.creationTimestamp ?? "").localeCompare(
        first.metadata.creationTimestamp ?? "",
      ),
  )[0];
}

export function ordersOf(request: CertificateRequestLike, orders: OrderLike[]): OrderLike[] {
  return childrenOf(request, orders);
}

export function challengesOf(order: OrderLike, challenges: ChallengeLike[]): ChallengeLike[] {
  return childrenOf(order, challenges);
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

  const awaiting = state === "pending" && isAwaitingApproval(request);

  return {
    kind: "CertificateRequest",
    name: request.getName(),
    namespace: request.getNs(),
    state,
    reason:
      state === "ok"
        ? undefined
        : awaiting
          ? AWAITING_APPROVAL
          : ((refused ? conditionOf(request, refused)?.message : undefined) ?? ready?.message),
  };
}

export interface ChainInputs {
  index: IssuerIndex;
  requests: CertificateRequestLike[];
  orders: OrderLike[];
  challenges: ChallengeLike[];
}

function issuerLink(certificate: CertificateLike, index: IssuerIndex): ChainLink | undefined {
  const ref = certificate.spec.issuerRef;
  const kind = issuerKindOf(ref);

  if (kind === "External") return undefined;

  const issuer = resolveIssuer(certificate, index);
  const namespace = issuerNamespace(kind, certificate.getNs());

  if (!issuer) {
    return index.unlisted?.has(kind)
      ? {
          kind,
          name: ref.name,
          namespace,
          state: "unknown",
          reason: `${kind}s could not be listed, so whether it exists is not known`,
        }
      : {
          kind,
          name: ref.name,
          namespace,
          state: "missing",
          reason: `No ${kind} named ${ref.name}${namespace ? ` in ${namespace}` : ""}`,
        };
  }

  const ready = isIssuerReady(issuer);

  return {
    kind,
    name: issuer.getName(),
    namespace,
    state: ready ? "ok" : "failed",
    reason: ready ? undefined : conditionOf(issuer, "Ready")?.message,
  };
}

function acmeLink(kind: "Order" | "Challenge", object: OrderLike | ChallengeLike): ChainLink {
  const state = acmeLinkState(object.status?.state);

  return {
    kind,
    name: object.getName(),
    namespace: object.getNs(),
    state,
    reason: state === "ok" ? undefined : object.status?.reason,
  };
}

export function chainInputsOf(stores: {
  issuers: IssuerLike[];
  clusterIssuers: IssuerLike[];
  unknown: readonly string[];
  requests: CertificateRequestLike[];
  orders: OrderLike[];
  challenges: ChallengeLike[];
}): ChainInputs {
  return {
    index: issuerIndexOf(stores),
    requests: stores.requests,
    orders: stores.orders,
    challenges: stores.challenges,
  };
}

export function chainOf(certificate: CertificateLike, inputs: ChainInputs): ChainLink[] {
  const issuer = issuerLink(certificate, inputs.index);
  const chain: ChainLink[] = issuer ? [issuer] : [];

  chain.push(certificateLink(certificate));

  const request = latestRequestOf(certificate, inputs.requests);

  if (!request) return chain;

  chain.push(requestLink(request));

  for (const order of ordersOf(request, inputs.orders)) {
    chain.push(acmeLink("Order", order));

    for (const challenge of challengesOf(order, inputs.challenges)) {
      chain.push(acmeLink("Challenge", challenge));
    }
  }

  return chain;
}

// A broken or missing issuer wins even when the request only echoes it;
// otherwise the deepest link that is not fine and says something. Unknown is not trouble.
export function explanationOf(chain: ChainLink[]): ChainLink | undefined {
  const troubled = chain.filter((link) => link.state !== "ok" && link.state !== "unknown");
  const issuer = troubled.find((link) => link.kind === "Issuer" || link.kind === "ClusterIssuer");

  if (issuer) return issuer;

  return [...troubled].reverse().find((link) => link.reason) ?? troubled.at(-1);
}
