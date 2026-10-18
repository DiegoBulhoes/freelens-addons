import type { EventLike, ReplicaSetLike, SecretMetaLike, UserSpec } from "../shared/types";

export function eventTime(event: EventLike): string | undefined {
  return event.lastTimestamp ?? event.eventTime;
}

function belongsTo(rs: ReplicaSetLike, name: string): boolean {
  const own = rs.getName();
  const member = new RegExp(`^(data-volume-|logs-volume-)?${own}(-arb)?(-\\d+)?$`);

  return member.test(name);
}

// The probe's failure is the agent's whole log line, and its error a pod being stopped: the pod says more.
const NOISE =
  /^(\(combined from similar events\): )?Readiness probe (failed: \{|errored and resulted in unknown state)/;

/** Warnings about the cluster, its pods, StatefulSets and volumes, newest first. */
export function replicaSetEvents(events: EventLike[], rs: ReplicaSetLike): EventLike[] {
  return events
    .filter(
      (event) =>
        event.metadata.namespace === rs.getNs() &&
        event.type !== "Normal" &&
        belongsTo(rs, event.involvedObject.name) &&
        !NOISE.test(event.message ?? ""),
    )
    .sort((a, b) => (eventTime(b) ?? "").localeCompare(eventTime(a) ?? ""));
}

/** The namespace's warning events, or why they could not be listed. */
export type WarningsRead = { events: EventLike[] } | { error: string };

/** A failed re-list keeps the events read before, so a passing error does not blank the section. */
export function nextWarnings(before: WarningsRead | undefined, after: WarningsRead): WarningsRead {
  return "error" in after && before && "events" in before ? before : after;
}

/** What the drawer says above its warnings; undefined once there are some to list. */
export function warningsNote(read: WarningsRead | undefined, found: number): string | undefined {
  if (!read) return "Reading its namespace's warning events…";
  if ("error" in read) return `Could not read its namespace's events (${read.error}).`;

  return found === 0 ? "No warning events for the cluster, its pods or its volumes." : undefined;
}

export interface UserView {
  user: UserSpec;
  /** False when the Secret its password comes from does not exist. */
  hasPassword: boolean;
  connectionSecret: string;
  connectionNamespace: string;
  /** False once its namespace is listed without it; undefined until then. */
  connectionExists?: boolean;
}

/** Each namespace's Secrets; a namespace absent has not answered yet, so nothing in it is judged. */
export type SecretNames = ReadonlyMap<string, SecretMetaLike[]>;

function secretsIn(namespace: string | undefined, secrets: SecretNames | undefined) {
  return secrets?.get(namespace ?? "");
}

/** Undefined while the namespace is unlisted. */
function secretExists(
  namespace: string | undefined,
  name: string,
  secrets: SecretNames | undefined,
): boolean | undefined {
  return secretsIn(namespace, secrets)?.some((secret) => secret.metadata.name === name);
}

const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const MAX_NAME = 253;

/** As the operator's normalizeName: a valid name is kept, any other is lowered and dashed. */
export function normalizeName(name: string): string {
  if (name.length <= MAX_NAME && DNS_SUBDOMAIN.test(name)) return name;

  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME);
}

export function connectionSecretOf(rs: ReplicaSetLike, user: UserSpec): string {
  return (
    user.connectionStringSecretName ?? normalizeName(`${rs.getName()}-${user.db}-${user.name}`)
  );
}

export function usersOf(rs: ReplicaSetLike, secrets: SecretNames | undefined): UserView[] {
  return (rs.spec.users ?? []).map((user) => {
    const connectionSecret = connectionSecretOf(rs, user);
    const connectionNamespace = user.connectionStringSecretNamespace ?? rs.getNs() ?? "";

    return {
      user,
      // Unknown until the Secrets are listed: assume present rather than raise a false alarm.
      hasPassword:
        !user.passwordSecretRef ||
        secretExists(rs.getNs(), user.passwordSecretRef.name, secrets) !== false,
      connectionSecret,
      connectionNamespace,
      connectionExists: secretExists(connectionNamespace, connectionSecret, secrets),
    };
  });
}

/** The first user's connection Secret, as shell commands read it; none once it is known missing. */
export function connectionOf(users: UserView[]): { namespace: string; name: string } | undefined {
  const first = users[0];

  return first && first.connectionExists !== false
    ? { namespace: first.connectionNamespace, name: first.connectionSecret }
    : undefined;
}

export interface TlsView {
  enabled: boolean;
  optional: boolean;
  /** The Secret with the certificate and key. */
  secret?: string;
  /** Where the CA comes from. */
  ca?: string;
  /** The CA's Secret, when it comes from one. */
  caSecret?: string;
  /** Set when cert-manager issued the Secret: its Certificate and issuer. */
  certManager?: { certificate: string; issuer: string; issuerKind: string };
  /** Secrets it names that its listed namespace lacks: the operator waits for them. */
  missing: string[];
}

const CERT_MANAGER = "cert-manager.io/";

export function tlsOf(rs: ReplicaSetLike, secrets: SecretNames | undefined): TlsView {
  const tls = rs.spec.security?.tls;

  if (!tls?.enabled) return { enabled: false, optional: tls?.optional === true, missing: [] };

  const secret = tls.certificateKeySecretRef?.name;
  const annotations = secretsIn(rs.getNs(), secrets)?.find((each) => each.metadata.name === secret)
    ?.metadata.annotations;
  const certificate = annotations?.[`${CERT_MANAGER}certificate-name`];
  const caSecret = tls.caCertificateSecretRef?.name;
  const caMap = tls.caConfigMapRef?.name;

  return {
    enabled: true,
    optional: tls.optional === true,
    secret,
    ca: caSecret ? `Secret ${caSecret}` : caMap ? `ConfigMap ${caMap}` : undefined,
    caSecret,
    certManager: certificate
      ? {
          certificate,
          issuer: annotations?.[`${CERT_MANAGER}issuer-name`] ?? "",
          issuerKind: annotations?.[`${CERT_MANAGER}issuer-kind`] || "Issuer",
        }
      : undefined,
    missing: [...new Set([secret, caSecret])].filter(
      (each): each is string =>
        each !== undefined && secretExists(rs.getNs(), each, secrets) === false,
    ),
  };
}

export function describeTls(view: TlsView): string {
  if (!view.enabled) return "Off";

  const by = view.certManager
    ? ` · issued by cert-manager (Certificate ${view.certManager.certificate}, ${view.certManager.issuerKind} ${view.certManager.issuer})`
    : "";

  return `On${view.optional ? ", optional" : ""}${by}`;
}

/** The status URL has no credentials; TLS has to be asked for, or a client connects in plain text. */
export function connectionUrl(rs: ReplicaSetLike): string | undefined {
  const uri = rs.status?.mongoUri;

  if (!uri) return undefined;
  if (!rs.spec.security?.tls?.enabled) return uri;

  return `${uri}${uri.includes("?") ? "&" : "?"}tls=true`;
}

export function securityOf(rs: ReplicaSetLike): { label: string; value: string }[] {
  const modes = rs.spec.security?.authentication?.modes ?? [];

  return [
    { label: "Authentication", value: modes.length > 0 ? modes.join(", ") : "None" },
    {
      label: "Metrics",
      value: rs.spec.prometheus ? `Prometheus on port ${rs.spec.prometheus.port ?? 9216}` : "Off",
    },
  ];
}

export interface PartialObjectMetadataList {
  items?: {
    metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
  }[];
}

export const METADATA_ONLY = "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1";

/** Names and cert-manager's annotations: the rest is dropped on arrival, since last-applied carries the values. */
export function secretNamesFrom(list: PartialObjectMetadataList): SecretMetaLike[] {
  return (list.items ?? []).flatMap((item) => {
    const metadata = item.metadata;

    if (!metadata?.name) return [];

    const annotations = Object.fromEntries(
      Object.entries(metadata.annotations ?? {}).filter(([key]) => key.startsWith(CERT_MANAGER)),
    );

    return [{ metadata: { name: metadata.name, namespace: metadata.namespace, annotations } }];
  });
}

/** Any namespace refused: the next listing comes sooner. */
export function anyRefused(results: readonly PromiseSettledResult<unknown>[]): boolean {
  return results.some((result) => result.status === "rejected");
}

/** A namespace that answered is listed afresh; one that did not keeps what it listed before, if anything. */
export function settledSecretNames(
  namespaces: readonly string[],
  results: readonly PromiseSettledResult<PartialObjectMetadataList>[],
  before?: SecretNames,
): Map<string, SecretMetaLike[]> {
  const after = new Map<string, SecretMetaLike[]>();

  namespaces.forEach((namespace, at) => {
    const result = results[at];
    const kept = before?.get(namespace);

    if (result?.status === "fulfilled") after.set(namespace, secretNamesFrom(result.value));
    else if (kept) after.set(namespace, kept);
  });

  return after;
}
