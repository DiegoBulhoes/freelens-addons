import { KubeObject } from "@freelensapp/kube-object";

import type { IssuerIndex } from "../src/renderer/api/issuers";
import {
  Certificate,
  CertificateRequest,
  Challenge,
  ClusterIssuer,
  Issuer,
  Order,
} from "../src/renderer/api/kinds";
import type {
  CertificateLike,
  CertificateRequestLike,
  ChallengeLike,
  IngressLike,
  IssuerLike,
  OrderLike,
  SecretLike,
} from "../src/renderer/api/types";
import certificateRequestsJson from "./fixtures/certificate-requests.json";
import certificatesJson from "./fixtures/certificates.json";
import challengesJson from "./fixtures/challenges.json";
import clusterIssuersJson from "./fixtures/cluster-issuers.json";
import exportedAt from "./fixtures/exported-at.json";
import ingressesJson from "./fixtures/ingresses.json";
import issuersJson from "./fixtures/issuers.json";
import ordersJson from "./fixtures/orders.json";
import tlsSecretsJson from "./fixtures/tls-secrets.json";

/**
 * Real contents of the development cluster, exported by
 * `scripts/export-fixtures.sh` and sanitised: Secrets carry no data, requests no
 * CSR and no requester, and nothing names the machine. The cluster was seeded to
 * be awkward — a certificate whose renewal is failing while it is still valid, one
 * naming an issuer that does not exist, one waiting on an issuer that never became
 * ready, an ACME certificate stuck at its Challenge, an Ingress serving a Secret
 * nothing manages — because those are the cases the extension exists for.
 */

type Raw = { items: unknown[] };

function build<T>(Kind: new (data: never) => T, json: unknown): T[] {
  return (json as Raw).items.map((item) => new Kind(item as never));
}

export function certificates(): CertificateLike[] {
  return build(Certificate, certificatesJson) as unknown as CertificateLike[];
}

export function certificateRequests(): CertificateRequestLike[] {
  return build(CertificateRequest, certificateRequestsJson) as unknown as CertificateRequestLike[];
}

export function issuers(): IssuerLike[] {
  return build(Issuer, issuersJson) as unknown as IssuerLike[];
}

export function clusterIssuers(): IssuerLike[] {
  return build(ClusterIssuer, clusterIssuersJson) as unknown as IssuerLike[];
}

export function issuerIndex(): IssuerIndex {
  return { issuers: issuers(), clusterIssuers: clusterIssuers() };
}

export function orders(): OrderLike[] {
  return build(Order, ordersJson) as unknown as OrderLike[];
}

export function challenges(): ChallengeLike[] {
  return build(Challenge, challengesJson) as unknown as ChallengeLike[];
}

/** The host's Secret and Ingress are KubeObjects too; the real base class stands in. */
export function tlsSecrets(): SecretLike[] {
  return build(KubeObject, tlsSecretsJson) as unknown as SecretLike[];
}

export function ingresses(): IngressLike[] {
  return build(KubeObject, ingressesJson) as unknown as IngressLike[];
}

/**
 * A real object with one thing changed, for the state the cluster did not
 * produce: an external issuer, a denied request, an order that went through.
 * Never a hand-written object — the change is the only part the test invents,
 * and every other field is exactly what the cluster returned.
 */
// biome-ignore lint/suspicious/noExplicitAny: a variant edits one field of whatever shape the kind has
export function variantOf<T extends object>(original: T, change: (raw: any) => void): T {
  const raw = JSON.parse(JSON.stringify(original));

  change(raw);

  return new (original.constructor as new (data: unknown) => T)(raw);
}

export function certificateNamed(name: string): CertificateLike {
  const found = certificates().find((each) => each.getName() === name);

  if (!found) throw new Error(`no certificate named ${name} in the fixtures`);

  return found;
}

/**
 * The moment the fixtures were exported. Unlike the other packages, this cannot
 * be the newest timestamp inside them: cert-manager writes renewalTime and
 * notAfter once, so the newest one can be the very instant a renewal fell due —
 * and measured from that instant, no renewal is ever late.
 */
export function fixtureNow(): number {
  return Date.parse(exportedAt.exportedAt);
}
