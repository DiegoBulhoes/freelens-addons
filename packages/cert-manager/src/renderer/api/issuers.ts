import { conditionOf } from "./expiry";
import type { CertificateLike, IssuerLike, IssuerRef } from "./types";

const CERT_MANAGER_GROUP = "cert-manager.io";

export type IssuerKind = "Issuer" | "ClusterIssuer" | "External";

// Another `group` is an external issuer (AWS PCA, step-ca...) this extension cannot judge.
export function issuerKindOf(ref: IssuerRef): IssuerKind {
  if (ref.group && ref.group !== CERT_MANAGER_GROUP) return "External";

  return ref.kind === "ClusterIssuer" ? "ClusterIssuer" : "Issuer";
}

export interface IssuerIndex {
  issuers: IssuerLike[];
  clusterIssuers: IssuerLike[];
}

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
  namespace?: string;
  dependents: CertificateLike[];
}

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

export function issuerStatusOf(row: IssuerRow): { label: string; tone: "critical" | "ok" } {
  return row.ready
    ? { label: "Ready", tone: "ok" }
    : { label: row.reason ?? "Not ready", tone: "critical" };
}

export function issuersHeadline(rows: IssuerRow[], missing: MissingIssuer[]): string {
  const total = rows.length + missing.length;
  const failing = rows.filter((row) => !row.ready).length + missing.length;

  if (total === 0) return "No issuers";
  if (failing === 0) return `All ${total} ${total === 1 ? "issuer is" : "issuers are"} ready`;

  return `${failing} of ${total} ${total === 1 ? "issuer" : "issuers"} ${failing === 1 ? "is" : "are"} not ready or missing`;
}
