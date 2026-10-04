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

export function issuerKey(kind: string, namespace: string | undefined, name: string): string {
  return `${kind}/${namespace ?? ""}/${name}`;
}

export interface IssuerEntry {
  key: string;
  kind: "Issuer" | "ClusterIssuer";
  name: string;
  namespace?: string;
  /** Absent for one that certificates name and that does not exist. */
  issuer?: IssuerLike;
  type?: IssuerType;
  state: { tone: "critical" | "ok"; label: string; reason: string };
  dependents: CertificateLike[];
}

function certificatesCount(count: number): string {
  return `${count} ${count === 1 ? "certificate" : "certificates"}`;
}

// Broken first, then named and missing, then ready: the order the page always had.
export function getIssuerEntries(
  index: IssuerIndex,
  certificates: CertificateLike[],
): IssuerEntry[] {
  const rows = getIssuerRows(index, certificates);
  const fromRow = (row: IssuerRow): IssuerEntry => {
    const namespace = row.kind === "Issuer" ? row.issuer.getNs() : undefined;

    return {
      key: issuerKey(row.kind, namespace, row.issuer.getName()),
      kind: row.kind,
      name: row.issuer.getName(),
      namespace,
      issuer: row.issuer,
      type: row.type,
      state: {
        ...issuerStatusOf(row),
        reason:
          row.message ??
          (row.ready ? "Ready to sign." : "cert-manager reports it not ready, without a message."),
      },
      dependents: row.dependents,
    };
  };
  const missing = getMissingIssuers(index, certificates).map(
    (entry): IssuerEntry => ({
      key: issuerKey(entry.kind, entry.namespace, entry.name),
      kind: entry.kind,
      name: entry.name,
      namespace: entry.namespace,
      state: {
        tone: "critical",
        label: "Missing",
        reason: `Named by ${certificatesCount(entry.dependents.length)} and not found. Create it, or correct the name in the certificates that use it.`,
      },
      dependents: entry.dependents,
    }),
  );

  return [
    ...rows.filter((row) => !row.ready).map(fromRow),
    ...missing,
    ...rows.filter((row) => row.ready).map(fromRow),
  ];
}

/** What the issuer is configured with, as name/value pairs; never a Secret's contents. */
export function issuerSettings(issuer: IssuerLike): { term: string; value: string }[] {
  const acme = issuer.spec.acme;
  const settings: [string, string | undefined][] = acme
    ? [
        ["ACME server", acme.server],
        ["Email", acme.email],
        ["Account key Secret", acme.privateKeySecretRef?.name],
        ["Account", issuer.status?.acme?.uri],
      ]
    : [["CA Secret", issuer.spec.ca?.secretName]];

  return settings.flatMap(([term, value]) => (value ? [{ term, value }] : []));
}

/** The issuers page's route params for the issuer a certificate names; none for an external one. */
export function issuerRouteOf(
  certificate: CertificateLike,
): { kind: string; namespace: string; name: string } | undefined {
  const ref = certificate.spec.issuerRef;
  const kind = issuerKindOf(ref);

  if (kind === "External") return undefined;

  return { kind, namespace: kind === "Issuer" ? (certificate.getNs() ?? "") : "", name: ref.name };
}
