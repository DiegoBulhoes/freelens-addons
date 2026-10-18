import { conditionOf } from "../certificates/expiry";
import { firstBy, type Index } from "../shared/index-by";
import type { CertificateLike, IssuerLike, IssuerRef } from "../shared/types";
import type { Verdict } from "../shared/verdict";

const CERT_MANAGER_GROUP = "cert-manager.io";

export type IssuerKind = "Issuer" | "ClusterIssuer" | "External";

type StoredKind = Exclude<IssuerKind, "External">;

// Another `group` is an external issuer (AWS PCA, step-ca...) this extension cannot judge.
export function issuerKindOf(ref: IssuerRef): IssuerKind {
  if (ref.group && ref.group !== CERT_MANAGER_GROUP) return "External";

  return ref.kind === "ClusterIssuer" ? "ClusterIssuer" : "Issuer";
}

export interface IssuerIndex {
  issuers: IssuerLike[];
  clusterIssuers: IssuerLike[];
  /** Kinds whose list failed: an issuer of these that is not found is unknown, not missing. */
  unlisted?: ReadonlySet<string>;
}

export function issuerKey(kind: string, namespace: string | undefined, name: string): string {
  return `${kind}/${namespace ?? ""}/${name}`;
}

/** A ClusterIssuer has no namespace. */
export function issuerNamespace(kind: string, namespace: string | undefined): string | undefined {
  return kind === "Issuer" ? namespace : undefined;
}

function issuerKeyOf(
  kind: StoredKind,
  issuer: { getNs(): string | undefined; getName(): string },
): string {
  return issuerKey(kind, issuerNamespace(kind, issuer.getNs()), issuer.getName());
}

export function issuerIndexOf(stores: {
  issuers: IssuerLike[];
  clusterIssuers: IssuerLike[];
  unknown: readonly string[];
}): IssuerIndex {
  return {
    issuers: stores.issuers,
    clusterIssuers: stores.clusterIssuers,
    unlisted: new Set(stores.unknown),
  };
}

function refKeyOf(certificate: CertificateLike): string | undefined {
  const ref = certificate.spec.issuerRef;
  const kind = issuerKindOf(ref);

  if (kind === "External") return undefined;

  return issuerKey(kind, issuerNamespace(kind, certificate.getNs()), ref.name);
}

const keyedLists: Record<StoredKind, Index<IssuerLike>> = {
  Issuer: new WeakMap(),
  ClusterIssuer: new WeakMap(),
};

function keyed(index: IssuerIndex, kind: StoredKind): Map<string, IssuerLike> {
  const list = kind === "Issuer" ? index.issuers : index.clusterIssuers;

  return firstBy(keyedLists[kind], list, (issuer) => issuerKeyOf(kind, issuer));
}

export function resolveIssuer(
  certificate: CertificateLike,
  index: IssuerIndex,
): IssuerLike | undefined {
  const kind = issuerKindOf(certificate.spec.issuerRef);

  if (kind === "External") return undefined;

  const key = refKeyOf(certificate);

  return key === undefined ? undefined : keyed(index, kind).get(key);
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

export interface IssuerRow {
  issuer: IssuerLike;
  kind: StoredKind;
  type: IssuerType;
  ready: boolean;
  reason?: string;
  message?: string;
  dependents: CertificateLike[];
}

export interface NamedIssuer {
  kind: StoredKind;
  name: string;
  namespace?: string;
  dependents: CertificateLike[];
}

// One pass over the certificates, grouped by the issuer each names.
function groupByIssuer(certificates: CertificateLike[]): Map<string, NamedIssuer> {
  const groups = new Map<string, NamedIssuer>();

  for (const certificate of certificates) {
    const key = refKeyOf(certificate);

    if (key === undefined) continue;

    const ref = certificate.spec.issuerRef;
    const kind = issuerKindOf(ref) as StoredKind;
    const group = groups.get(key) ?? {
      kind,
      name: ref.name,
      namespace: issuerNamespace(kind, certificate.getNs()),
      dependents: [],
    };

    group.dependents.push(certificate);
    groups.set(key, group);
  }

  return groups;
}

function issuerRowsOf(index: IssuerIndex, groups: Map<string, NamedIssuer>): IssuerRow[] {
  const rows: IssuerRow[] = [
    ...index.issuers.map((issuer) => ({ issuer, kind: "Issuer" as const })),
    ...index.clusterIssuers.map((issuer) => ({ issuer, kind: "ClusterIssuer" as const })),
  ].map(({ issuer, kind }) => {
    const ready = conditionOf(issuer, "Ready");
    const key = issuerKeyOf(kind, issuer);
    const owner = keyed(index, kind).get(key);

    return {
      issuer,
      kind,
      type: issuerTypeOf(issuer),
      ready: isIssuerReady(issuer),
      reason: ready?.reason,
      message: ready?.message,
      dependents: owner === issuer ? (groups.get(key)?.dependents ?? []) : [],
    };
  });

  return rows.sort(
    (first, second) =>
      Number(first.ready) - Number(second.ready) ||
      second.dependents.length - first.dependents.length ||
      first.issuer.getName().localeCompare(second.issuer.getName()),
  );
}

/** Named and not found: missing among the kinds that were listed, unknown among the others. */
function absentIssuers(
  index: IssuerIndex,
  groups: Map<string, NamedIssuer>,
): { missing: NamedIssuer[]; unknown: NamedIssuer[] } {
  const missing: NamedIssuer[] = [];
  const unknown: NamedIssuer[] = [];

  for (const [key, group] of groups) {
    if (keyed(index, group.kind).has(key)) continue;

    (index.unlisted?.has(group.kind) ? unknown : missing).push(group);
  }

  const byName = (first: NamedIssuer, second: NamedIssuer) => first.name.localeCompare(second.name);

  return { missing: missing.sort(byName), unknown: unknown.sort(byName) };
}

export function issuerStatusOf(row: IssuerRow): { label: string; tone: "critical" | "ok" } {
  return row.ready
    ? { label: "Ready", tone: "ok" }
    : { label: row.reason ?? "Not ready", tone: "critical" };
}

export function describeIssuersHeadline(
  rows: IssuerRow[],
  missing: NamedIssuer[],
  unknown: NamedIssuer[] = [],
): string {
  const total = rows.length + missing.length + unknown.length;
  const failing = rows.filter((row) => !row.ready).length + missing.length;

  if (total === 0) return "No issuers";
  if (failing === 0 && unknown.length === 0) {
    return `All ${total} ${total === 1 ? "issuer is" : "issuers are"} ready`;
  }
  if (failing === 0) {
    return `${unknown.length} of ${total} ${total === 1 ? "issuer" : "issuers"} could not be checked; the rest are ready`;
  }

  return `${failing} of ${total} ${total === 1 ? "issuer" : "issuers"} ${failing === 1 ? "is" : "are"} not ready or missing`;
}

/** The overview's issuer sentence, naming only the troubles there are. */
export function issuerTroubleSentence(broken: number, missing: number, unknown: number): string {
  const parts = [
    broken > 0 ? `${broken} ${broken === 1 ? "issuer is" : "issuers are"} not ready` : "",
    missing > 0 ? `${missing} named ${missing === 1 ? "issuer does" : "issuers do"} not exist` : "",
  ].filter(Boolean);

  if (parts.length > 0) return `${parts.join(", and ")}.`;
  if (unknown > 0) {
    return `Whether ${unknown} named ${unknown === 1 ? "issuer exists" : "issuers exist"} is not known: ${unknown === 1 ? "its kind" : "their kinds"} could not be listed.`;
  }

  return "Every issuer in use exists and is ready.";
}

export function overviewSubline(
  certificatesKnown: boolean,
  total: number,
  issuers: IssuerSummary,
): string {
  if (!certificatesKnown) return "Without the Certificates list nothing here can be judged.";
  if (total === 0) {
    return "There is no Certificate in the namespaces chosen in the selector. Choose more to see theirs.";
  }

  return issuerTroubleSentence(
    issuers.rows.filter((row) => !row.ready).length,
    issuers.missing.length,
    issuers.unknown.length,
  );
}

export interface IssuerEntry {
  key: string;
  kind: StoredKind;
  name: string;
  namespace?: string;
  /** Absent for one that certificates name and that was not found. */
  issuer?: IssuerLike;
  type?: IssuerType;
  state: Verdict & { tone: "critical" | "info" | "ok" };
  dependents: CertificateLike[];
}

function certificatesCount(count: number): string {
  return `${count} ${count === 1 ? "certificate" : "certificates"}`;
}

export interface IssuerSummary {
  rows: IssuerRow[];
  missing: NamedIssuer[];
  /** Named by certificates, of a kind that could not be listed. */
  unknown: NamedIssuer[];
  entries: IssuerEntry[];
  headline: string;
}

// Broken first, then missing, then unknown, then ready: the order the page always had.
export function summariseIssuers(
  index: IssuerIndex,
  certificates: CertificateLike[],
): IssuerSummary {
  const groups = groupByIssuer(certificates);
  const rows = issuerRowsOf(index, groups);
  const { missing, unknown } = absentIssuers(index, groups);
  const fromRow = (row: IssuerRow): IssuerEntry => ({
    key: issuerKeyOf(row.kind, row.issuer),
    kind: row.kind,
    name: row.issuer.getName(),
    namespace: issuerNamespace(row.kind, row.issuer.getNs()),
    issuer: row.issuer,
    type: row.type,
    state: {
      ...issuerStatusOf(row),
      reason:
        row.message ??
        (row.ready ? "Ready to sign." : "cert-manager reports it not ready, without a message."),
    },
    dependents: row.dependents,
  });
  const fromAbsent =
    (state: (entry: NamedIssuer) => IssuerEntry["state"]) =>
    (entry: NamedIssuer): IssuerEntry => ({
      key: issuerKey(entry.kind, entry.namespace, entry.name),
      kind: entry.kind,
      name: entry.name,
      namespace: entry.namespace,
      state: state(entry),
      dependents: entry.dependents,
    });

  return {
    rows,
    missing,
    unknown,
    headline: describeIssuersHeadline(rows, missing, unknown),
    entries: [
      ...rows.filter((row) => !row.ready).map(fromRow),
      ...missing.map(
        fromAbsent((entry) => ({
          tone: "critical",
          label: "Missing",
          reason: `Named by ${certificatesCount(entry.dependents.length)} and not found. Create it, or correct the name in the certificates that use it.`,
        })),
      ),
      ...unknown.map(
        fromAbsent((entry) => ({
          tone: "info",
          label: "Unknown",
          reason: `Named by ${certificatesCount(entry.dependents.length)}. ${entry.kind}s could not be listed, so whether it exists is not known.`,
        })),
      ),
      ...rows.filter((row) => row.ready).map(fromRow),
    ],
  };
}

export type IssuerFilter = "all" | "trouble";

export const ISSUER_FILTER_LABELS: Record<IssuerFilter, string> = {
  all: "All",
  trouble: "Not ready or missing",
};

export const ISSUER_FILTER_TITLES: Record<IssuerFilter, string> = {
  all: "Shows every issuer, and every one certificates name",
  trouble: "Shows the issuers that are not ready and those named that do not exist",
};

export function isIssuerFilter(value: string): value is IssuerFilter {
  return Object.hasOwn(ISSUER_FILTER_LABELS, value);
}

/** Broken or missing: what the overview's issuer card counts. */
export function matchesIssuerFilter(entry: IssuerEntry, filter: IssuerFilter): boolean {
  return filter === "all" || entry.state.tone === "critical";
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

export interface IssuerRoute {
  kind: string;
  namespace: string;
  name: string;
}

/** The issuers page's route params for the issuer a certificate names; none for an external one. */
export function issuerRouteOf(certificate: CertificateLike): IssuerRoute | undefined {
  const ref = certificate.spec.issuerRef;
  const kind = issuerKindOf(ref);

  if (kind === "External") return undefined;

  return {
    kind,
    namespace: issuerNamespace(kind, certificate.getNs()) ?? "",
    name: ref.name,
  };
}
