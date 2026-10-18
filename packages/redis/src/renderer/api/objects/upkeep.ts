import { reasonOf } from "../shared/errors";
import type { EventLike, RedisLike, SecretMetaLike } from "../shared/types";
import { kindOf, setsOf } from "./nodes";

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
        event.metadata.namespace === object.getNs() &&
        event.type !== "Normal" &&
        belongs(event.involvedObject.name) &&
        !NOISE.test(event.message ?? ""),
    )
    .sort((a, b) => (eventTime(b) ?? "").localeCompare(eventTime(a) ?? ""));
}

export type WarningsRead = { events: EventLike[] } | { error: string };

/** A failed re-list keeps the events read before, so a passing error does not blank the section. */
export function nextWarnings(before: WarningsRead | undefined, after: WarningsRead): WarningsRead {
  return "error" in after && before && "events" in before ? before : after;
}

/** What the drawer says above its warnings; undefined once there are some to list. */
export function warningsNote(read: WarningsRead | undefined, found: number): string | undefined {
  if (!read) return "Reading its namespace's warning events…";
  if ("error" in read) return `Could not read its namespace's events (${read.error}).`;

  return found === 0 ? "No warning events for it, its pods or its volumes." : undefined;
}

export const tlsSecretOf = (object: RedisLike) => object.spec.TLS?.secret?.secretName;

export const passwordSecretOf = (object: RedisLike) => object.spec.kubernetesConfig?.redisSecret;

const CERT_MANAGER = "cert-manager.io/";

export interface TlsView {
  enabled: boolean;
  secret?: string;
  certManager?: { certificate: string; issuer: string; issuerKind: string };
  /** Why its namespace's Secrets could not be listed: who issued it is not known. */
  unread?: string;
}

/** One namespace's Secret names, or why the list was refused. */
export type SecretListing = SecretMetaLike[] | { error: string };

/** By namespace; a namespace not in it is not listed yet. */
export type SecretListings = ReadonlyMap<string, SecretListing>;

export function tlsOf(object: RedisLike, listings: SecretListings | undefined): TlsView {
  const secret = tlsSecretOf(object);

  if (!secret) return { enabled: false };

  const listing = listings?.get(object.getNs() ?? "");

  if (listing && "error" in listing) return { enabled: true, secret, unread: listing.error };

  const annotations = (listing ?? []).find((each) => each.metadata.name === secret)?.metadata
    .annotations;
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

/** What follows the Secret's name: who issued it, or why that is not known. */
export function describeTlsIssuer(view: TlsView): string {
  if (view.unread) return ` · its issuer could not be read (${view.unread})`;
  if (!view.certManager) return "";

  return ` · issued by cert-manager (Certificate ${view.certManager.certificate}, ${view.certManager.issuerKind} ${view.certManager.issuer})`;
}

/** Without the password: it lives in a Secret Freelens never reads. */
export function connectionUrls(object: RedisLike): { label: string; url: string }[] {
  const name = object.getName();
  const host = (service: string, port = 6379) =>
    `${tlsSecretOf(object) ? "rediss" : "redis"}://${service}.${object.getNs() ?? "default"}.svc:${port}`;

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
  const secret = passwordSecretOf(object);

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

/** Each namespace's own outcome: one refused or silent namespace hides no other's. */
export function settledListings(
  namespaces: readonly string[],
  results: readonly PromiseSettledResult<PartialObjectMetadataList>[],
): Map<string, SecretListing> {
  return new Map(
    namespaces.map((namespace, at): [string, SecretListing] => {
      const result = results[at];

      if (result?.status === "fulfilled") return [namespace, secretNamesFrom(result.value)];

      return [namespace, { error: result ? reasonOf(result.reason) : "not listed" }];
    }),
  );
}

/** A failed re-list keeps the names listed before, so a passing error does not hide an issuer. */
export function mergeListings(
  before: SecretListings | undefined,
  after: SecretListings,
): Map<string, SecretListing> {
  const merged = new Map<string, SecretListing>(before);

  for (const [namespace, listing] of after) {
    const kept = merged.get(namespace);

    merged.set(namespace, "error" in listing && kept && !("error" in kept) ? kept : listing);
  }

  return merged;
}

export function anyRefused(listings: SecretListings): boolean {
  return [...listings.values()].some((listing) => "error" in listing);
}

/** Only where an object uses TLS: no other Secret is worth a read. */
export function tlsNamespaces(objects: RedisLike[]): string[] {
  const namespaces = objects.filter(tlsSecretOf).map((object) => object.getNs() ?? "");

  return [...new Set(namespaces)].filter(Boolean).sort();
}
