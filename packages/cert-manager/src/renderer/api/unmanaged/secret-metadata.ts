import { CERT_MANAGER_PREFIX } from "../shared/annotations";
import { reasonOf } from "../shared/errors";
import type { SecretLike } from "../shared/types";
import { TLS_SECRET_TYPE } from "./unmanaged";

// Metadata only, never the host's secretStore (it loads every private key), and every
// annotation but cert-manager's dropped on arrival: last-applied carries the values.

const TLS_ONLY = `fieldSelector=${encodeURIComponent(`type=${TLS_SECRET_TYPE}`)}`;

export const TLS_SECRETS_PATH = `/api/v1/secrets?${TLS_ONLY}`;

/** For one who may list Secrets in some namespaces but not cluster-wide. */
export function namespaceTlsSecretsPath(namespace: string): string {
  return `/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets?${TLS_ONLY}`;
}

export const METADATA_ONLY = "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1";

interface PartialMetadata {
  name?: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
  annotations?: Record<string, string>;
}

export interface PartialObjectMetadataList {
  items?: { metadata?: PartialMetadata }[];
}

export function tlsSecretsFrom(list: PartialObjectMetadataList): SecretLike[] {
  return (list.items ?? []).flatMap((item) => {
    const metadata = item.metadata;

    if (!metadata?.name) return [];

    const annotations = Object.fromEntries(
      Object.entries(metadata.annotations ?? {}).filter(([key]) =>
        key.startsWith(CERT_MANAGER_PREFIX),
      ),
    );
    const name = metadata.name;
    const namespace = metadata.namespace;

    return [
      {
        getName: () => name,
        getNs: () => namespace,
        type: TLS_SECRET_TYPE,
        metadata: {
          uid: metadata.uid,
          creationTimestamp: metadata.creationTimestamp,
          annotations,
        },
      },
    ];
  });
}

/** Each namespace's TLS Secrets, or why they could not be listed; absent until asked. */
export type SecretListing = readonly SecretLike[] | { error: string };

export type SecretListings = ReadonlyMap<string, SecretListing>;

/** A cluster-wide list answers for every namespace asked about, those with no TLS Secret too. */
export function clusterListings(
  secrets: readonly SecretLike[],
  namespaces: readonly string[],
): Map<string, SecretLike[]> {
  const listings = new Map<string, SecretLike[]>(namespaces.map((namespace) => [namespace, []]));

  for (const secret of secrets) {
    const namespace = secret.getNs() ?? "";

    listings.set(namespace, [...(listings.get(namespace) ?? []), secret]);
  }

  return listings;
}

/** Each namespace's own outcome: one refused namespace leaves the others listed. */
export function settledListings(
  namespaces: readonly string[],
  results: readonly PromiseSettledResult<readonly SecretLike[]>[],
): Map<string, SecretListing> {
  return new Map(
    namespaces.map((namespace, at): [string, SecretListing] => {
      const result = results[at];

      if (result?.status === "fulfilled") return [namespace, result.value];

      return [namespace, { error: result ? reasonOf(result.reason) : "not listed" }];
    }),
  );
}

/** A failed re-list keeps what was listed before, so a passing error does not blank a row. */
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

export function isListedIn(listings: SecretListings, namespace: string): boolean {
  const listing = listings.get(namespace);

  return listing !== undefined && !("error" in listing);
}

export function listedSecrets(listings: SecretListings): SecretLike[] {
  return [...listings.values()].flatMap((listing) => ("error" in listing ? [] : listing));
}

/** The namespaces asked about whose Secrets are not known, and the first reason given. */
export function secretsRefusal(
  listings: SecretListings,
  namespaces: readonly string[],
): { namespaces: string[]; error: string; everywhere: boolean } | undefined {
  const refused = namespaces.flatMap((namespace) => {
    const listing = listings.get(namespace);

    return listing && "error" in listing ? [[namespace, listing.error] as const] : [];
  });
  const [first] = refused;

  if (!first) return undefined;

  return {
    namespaces: refused.map(([namespace]) => namespace),
    error: first[1],
    everywhere: refused.length === namespaces.length,
  };
}

/** At most `slots` reads at once, each settled in its own place: a cluster of namespaces stays a trickle. */
export async function settleInSlots<Item, Result>(
  items: readonly Item[],
  slots: number,
  read: (item: Item) => Promise<Result>,
): Promise<PromiseSettledResult<Result>[]> {
  const results: PromiseSettledResult<Result>[] = [];
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const at = next;

      next += 1;
      try {
        results[at] = { status: "fulfilled", value: await read(items[at] as Item) };
      } catch (reason) {
        results[at] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(slots, items.length) }, worker));

  return results;
}
