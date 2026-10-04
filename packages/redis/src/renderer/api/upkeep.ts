import { kindOf, setsOf } from "./nodes";
import type { EventLike, RedisLike, SecretMetaLike } from "./types";

export function eventTime(event: EventLike): string | undefined {
  return event.lastTimestamp ?? event.eventTime;
}

// The probe's failure says nothing its pod does not, and its error is a pod being stopped.
const NOISE =
  /^(\(combined from similar events\): )?Readiness probe (failed|errored and resulted in unknown state)/;

/** Warnings about the object, its pods, StatefulSets and volumes, newest first. */
export function eventsOf(events: EventLike[], object: RedisLike): EventLike[] {
  const apps = setsOf(object).map((each) => each.app);
  const own = new Set([object.getName(), ...apps]);
  const belongs = (name: string) =>
    own.has(name) || apps.some((app) => new RegExp(`^(${app}-)?${app}-\\d+$`).test(name));

  return events
    .filter(
      (event) =>
        event.getNs() === object.getNs() &&
        event.type !== "Normal" &&
        belongs(event.involvedObject.name) &&
        !NOISE.test(event.message ?? ""),
    )
    .sort((a, b) => (eventTime(b) ?? "").localeCompare(eventTime(a) ?? ""));
}

const CERT_MANAGER = "cert-manager.io/";

export interface TlsView {
  enabled: boolean;
  secret?: string;
  certManager?: { certificate: string; issuer: string; issuerKind: string };
}

export function tlsOf(object: RedisLike, secrets: SecretMetaLike[] | undefined): TlsView {
  const secret = object.spec.TLS?.secret?.secretName;

  if (!secret) return { enabled: false };

  const annotations = (secrets ?? []).find(
    (each) => each.metadata.name === secret && each.metadata.namespace === object.getNs(),
  )?.metadata.annotations;
  const certificate = annotations?.[`${CERT_MANAGER}certificate-name`];

  return {
    enabled: true,
    secret,
    certManager: certificate
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

  return `On · Secret ${view.secret}${by}`;
}

/** Without the password: it lives in a Secret Freelens never reads. */
export function connectionUrls(object: RedisLike): { label: string; url: string }[] {
  const name = object.getName();
  const host = (service: string, port = 6379) =>
    `${object.spec.TLS?.secret?.secretName ? "rediss" : "redis"}://${service}.${object.getNs() ?? "default"}.svc:${port}`;

  switch (kindOf(object)) {
    case "Replication":
      return [
        { label: "Master (read-write)", url: host(`${name}-master`) },
        { label: "Replicas (read-only)", url: host(`${name}-replica`) },
      ];
    case "Cluster":
      return [
        {
          label: "Cluster (a client in cluster mode follows redirects)",
          url: host(`${name}-leader`),
        },
      ];
    case "Sentinel":
      return [{ label: "Sentinels", url: host(`${name}-sentinel`, 26379) }];
    default:
      return [{ label: "Redis", url: host(name) }];
  }
}

/** The password, read in the terminal from the Secret the object names. */
export function passwordCommand(object: RedisLike): string | undefined {
  const secret = object.spec.kubernetesConfig?.redisSecret;

  if (!secret?.name) return undefined;

  return `kubectl get secret -n ${object.getNs() ?? "default"} ${secret.name} -o jsonpath='{.data.${(secret.key ?? "password").replace(/\./g, "\\.")}}' | base64 -d`;
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
