import { reasonOf } from "../shared/errors";
import type { SecretMetaLike } from "../shared/types";

export const CERT_MANAGER = "cert-manager.io/";

export const METADATA_ONLY = "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1";

export interface PartialObjectMetadataList {
  items?: {
    metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
  }[];
}

/** Names and cert-manager's annotations: the rest is dropped on arrival, since last-applied carries the values. */
export function secretMetadataFrom(list: PartialObjectMetadataList): SecretMetaLike[] {
  return (list.items ?? []).flatMap((item) => {
    const metadata = item.metadata;

    if (!metadata?.name) return [];

    const annotations = Object.fromEntries(
      Object.entries(metadata.annotations ?? {}).filter(([key]) => key.startsWith(CERT_MANAGER)),
    );

    return [{ metadata: { name: metadata.name, namespace: metadata.namespace, annotations } }];
  });
}

/** One namespace's Secrets, names and cert-manager annotations only, or why they were not listed. */
export type SecretListing = SecretMetaLike[] | { error: string };

/** By namespace; a namespace not in it is not listed yet. */
export type SecretListings = ReadonlyMap<string, SecretListing>;

/** Each namespace's own outcome: one refused namespace leaves the others listed. */
export function settledListings(
  namespaces: readonly string[],
  results: readonly PromiseSettledResult<PartialObjectMetadataList>[],
): Map<string, SecretListing> {
  return new Map(
    namespaces.map((namespace, at): [string, SecretListing] => {
      const result = results[at];

      if (result?.status === "fulfilled") return [namespace, secretMetadataFrom(result.value)];

      return [namespace, { error: result ? reasonOf(result.reason) : "not listed" }];
    }),
  );
}

/** A failed re-list keeps the names listed before, so a passing error does not blank a row. */
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

/** Undefined while the namespace is not listed or was refused: then nothing is claimed. */
export function secretsIn(
  listings: SecretListings | undefined,
  namespace: string | undefined,
): SecretMetaLike[] | undefined {
  const listing = listings?.get(namespace ?? "");

  return listing && !("error" in listing) ? listing : undefined;
}

export function secretsRefusal(
  listings: SecretListings | undefined,
  namespace: string | undefined,
): string | undefined {
  const listing = listings?.get(namespace ?? "");

  return listing && "error" in listing
    ? `Could not list the Secrets in ${namespace}: ${listing.error}. Who issued each certificate is not known.`
    : undefined;
}

export function anyRefused(listings: SecretListings): boolean {
  return [...listings.values()].some((listing) => "error" in listing);
}
