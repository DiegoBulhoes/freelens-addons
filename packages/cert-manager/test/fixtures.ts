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

export function tlsSecrets(): SecretLike[] {
  return build(KubeObject, tlsSecretsJson) as unknown as SecretLike[];
}

export function ingresses(): IngressLike[] {
  return build(KubeObject, ingressesJson) as unknown as IngressLike[];
}

// A real object with one field changed, for a state the cluster did not produce.
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

// Not the newest timestamp: that can be the instant a renewal fell due, from which none is late.
export function fixtureNow(): number {
  return Date.parse(exportedAt.exportedAt);
}
