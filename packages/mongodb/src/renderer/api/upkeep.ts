import type { EventLike, ReplicaSetLike, SecretMetaLike, UserSpec } from "./types";

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
        event.getNs() === rs.getNs() &&
        event.type !== "Normal" &&
        belongsTo(rs, event.involvedObject.name) &&
        !NOISE.test(event.message ?? ""),
    )
    .sort((a, b) => (eventTime(b) ?? "").localeCompare(eventTime(a) ?? ""));
}

export interface UserView {
  user: UserSpec;
  /** False when the Secret its password comes from does not exist. */
  hasPassword: boolean;
  connectionSecret: string;
}

export function usersOf(rs: ReplicaSetLike, secrets: SecretMetaLike[] | undefined): UserView[] {
  const namespace = rs.getNs();
  const names = new Set(
    (secrets ?? [])
      .filter((secret) => secret.metadata.namespace === namespace)
      .map((secret) => secret.metadata.name),
  );

  return (rs.spec.users ?? []).map((user) => ({
    user,
    // Unknown until the Secrets are listed: assume present rather than raise a false alarm.
    hasPassword: !secrets || !user.passwordSecretRef || names.has(user.passwordSecretRef.name),
    connectionSecret: user.connectionStringSecretName ?? `${rs.getName()}-${user.db}-${user.name}`,
  }));
}

export interface TlsView {
  enabled: boolean;
  optional: boolean;
  /** The Secret with the certificate and key. */
  secret?: string;
  /** Where the CA comes from. */
  ca?: string;
  /** Set when cert-manager issued the Secret: its Certificate and issuer. */
  certManager?: { certificate: string; issuer: string; issuerKind: string };
}

const CERT_MANAGER = "cert-manager.io/";

export function tlsOf(rs: ReplicaSetLike, secrets: SecretMetaLike[] | undefined): TlsView {
  const tls = rs.spec.security?.tls;
  const secret = tls?.certificateKeySecretRef?.name;
  const annotations = (secrets ?? []).find(
    (each) => each.metadata.name === secret && each.metadata.namespace === rs.getNs(),
  )?.metadata.annotations;
  const certificate = annotations?.[`${CERT_MANAGER}certificate-name`];
  const caSecret = tls?.caCertificateSecretRef?.name;
  const caMap = tls?.caConfigMapRef?.name;

  return {
    enabled: tls?.enabled === true,
    optional: tls?.optional === true,
    secret: tls?.enabled ? secret : undefined,
    ca: !tls?.enabled
      ? undefined
      : caSecret
        ? `Secret ${caSecret}`
        : caMap
          ? `ConfigMap ${caMap}`
          : undefined,
    certManager:
      tls?.enabled && certificate
        ? {
            certificate,
            issuer: annotations?.[`${CERT_MANAGER}issuer-name`] ?? "",
            issuerKind: annotations?.[`${CERT_MANAGER}issuer-kind`] || "Issuer",
          }
        : undefined,
  };
}

export function describeTls(view: TlsView): string {
  if (!view.enabled) return "Off";

  const by = view.certManager
    ? ` · issued by cert-manager (Certificate ${view.certManager.certificate}, ${view.certManager.issuerKind} ${view.certManager.issuer})`
    : "";

  return `On${view.optional ? ", optional" : ""}${view.secret ? ` · Secret ${view.secret}` : ""}${by}`;
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
