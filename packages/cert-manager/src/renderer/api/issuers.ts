import { conditionOf } from "./expiry";
import type { CertificateLike, IssuerLike, IssuerRef } from "./types";

/**
 * Which issuer a certificate names, whether it exists, and whether it works.
 *
 * One broken issuer is many broken certificates, and a list of issuers shows
 * none of them. These rules draw the line between the two.
 */

const CERT_MANAGER_GROUP = "cert-manager.io";

export type IssuerKind = "Issuer" | "ClusterIssuer" | "External";

/**
 * `kind` is optional in an issuerRef and means `Issuer` when absent. A `group`
 * other than cert-manager's names an external issuer — AWS PCA, Google CAS,
 * step-ca — whose objects this extension does not read and cannot judge.
 */
export function issuerKindOf(ref: IssuerRef): IssuerKind {
  if (ref.group && ref.group !== CERT_MANAGER_GROUP) return "External";

  return ref.kind === "ClusterIssuer" ? "ClusterIssuer" : "Issuer";
}

export interface IssuerIndex {
  issuers: IssuerLike[];
  clusterIssuers: IssuerLike[];
}

/** The issuer a certificate names: an Issuer in its own namespace, or a ClusterIssuer. */
export function resolveIssuer(
  certificate: CertificateLike,
  index: IssuerIndex,
): IssuerLike | undefined {
  const ref = certificate.spec.issuerRef;
  const kind = issuerKindOf(ref);

  if (kind === "ClusterIssuer") {
    return index.clusterIssuers.find((each) => each.getName() === ref.name);
  }

  if (kind === "Issuer") {
    return index.issuers.find(
      (each) => each.getName() === ref.name && each.getNs() === certificate.getNs(),
    );
  }

  return undefined;
}

export function isIssuerReady(issuer: IssuerLike): boolean {
  return conditionOf(issuer, "Ready")?.status === "True";
}

export type IssuerType = "ACME" | "CA" | "Self-signed" | "Vault" | "Venafi" | "Other";

export function issuerTypeOf(issuer: IssuerLike): IssuerType {
  const spec = issuer.spec;

  if (spec.acme) return "ACME";
  if (spec.ca) return "CA";
  if (spec.selfSigned) return "Self-signed";
  if (spec.vault) return "Vault";
  if (spec.venafi) return "Venafi";

  return "Other";
}

/** Whether a certificate is waiting on an issuer that exists and is not ready. */
export function dependsOnBrokenIssuer(certificate: CertificateLike, index: IssuerIndex): boolean {
  const issuer = resolveIssuer(certificate, index);

  return issuer !== undefined && !isIssuerReady(issuer);
}

export interface IssuerRow {
  issuer: IssuerLike;
  kind: "Issuer" | "ClusterIssuer";
  type: IssuerType;
  ready: boolean;
  reason?: string;
  message?: string;
  dependents: CertificateLike[];
}

/**
 * Every issuer, with the certificates that name it. Broken ones first, and
 * among those the ones more certificates depend on — that is the order an
 * operator fixes them in.
 */
export function getIssuerRows(index: IssuerIndex, certificates: CertificateLike[]): IssuerRow[] {
  const rows: IssuerRow[] = [
    ...index.issuers.map((issuer) => ({ issuer, kind: "Issuer" as const })),
    ...index.clusterIssuers.map((issuer) => ({ issuer, kind: "ClusterIssuer" as const })),
  ].map(({ issuer, kind }) => {
    const ready = conditionOf(issuer, "Ready");

    return {
      issuer,
      kind,
      type: issuerTypeOf(issuer),
      ready: ready?.status === "True",
      reason: ready?.reason,
      message: ready?.message,
      dependents: certificates.filter(
        (certificate) => resolveIssuer(certificate, index) === issuer,
      ),
    };
  });

  return rows.sort(
    (first, second) =>
      Number(first.ready) - Number(second.ready) ||
      second.dependents.length - first.dependents.length ||
      first.issuer.getName().localeCompare(second.issuer.getName()),
  );
}

export interface MissingIssuer {
  kind: "Issuer" | "ClusterIssuer";
  name: string;
  /** Where it was looked for: the certificate's namespace for an Issuer. */
  namespace?: string;
  dependents: CertificateLike[];
}

/**
 * Issuers that certificates name and that do not exist. Not an issuer that is
 * broken — there is nothing to be broken — which is why these are counted apart:
 * the fix is to create something, or to correct a name.
 */
export function getMissingIssuers(
  index: IssuerIndex,
  certificates: CertificateLike[],
): MissingIssuer[] {
  const missing = new Map<string, MissingIssuer>();

  for (const certificate of certificates) {
    const ref = certificate.spec.issuerRef;
    const kind = issuerKindOf(ref);

    if (kind === "External" || resolveIssuer(certificate, index)) continue;

    const namespace = kind === "Issuer" ? certificate.getNs() : undefined;
    const key = `${kind}/${namespace ?? ""}/${ref.name}`;
    const entry = missing.get(key) ?? { kind, name: ref.name, namespace, dependents: [] };

    entry.dependents.push(certificate);
    missing.set(key, entry);
  }

  return [...missing.values()].sort((first, second) => first.name.localeCompare(second.name));
}
