import { reasonOf } from "../shared/errors";
export interface PartialObjectMetadataList {
  items?: { metadata?: { name?: string; namespace?: string } }[];
}

export const METADATA_ONLY = "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1";

/** `namespace/name` of each listed object, and nothing else of it. */
export function namesFrom(list: PartialObjectMetadataList): Set<string> {
  return new Set(
    (list.items ?? []).flatMap((item) =>
      item.metadata?.name ? [`${item.metadata.namespace ?? ""}/${item.metadata.name}`] : [],
    ),
  );
}

/** One namespace's listing: `namespace/name` of each object, or why it was refused. */
export type Listing = ReadonlySet<string> | { error: string };

/** By namespace; a namespace not in it is not listed yet. */
export type Listings = ReadonlyMap<string, Listing>;

export interface ReferenceNames {
  secrets?: Listings;
  configMaps?: Listings;
}

/** Each namespace's own outcome: one refused namespace leaves the others listed. */
export function settledListings(
  namespaces: readonly string[],
  results: readonly PromiseSettledResult<PartialObjectMetadataList>[],
): Map<string, Listing> {
  return new Map(
    namespaces.map((namespace, at): [string, Listing] => {
      const result = results[at];

      if (result?.status === "fulfilled") return [namespace, namesFrom(result.value)];

      return [namespace, { error: result ? reasonOf(result.reason) : "not listed" }];
    }),
  );
}

/** A failed re-list keeps the names listed before, so a passing error does not blank a row. */
export function mergeListings(before: Listings | undefined, after: Listings): Map<string, Listing> {
  const merged = new Map<string, Listing>(before);

  for (const [namespace, listing] of after) {
    const kept = merged.get(namespace);

    merged.set(namespace, "error" in listing && kept && !("error" in kept) ? kept : listing);
  }

  return merged;
}

export function anyRefused(...listings: (Listings | undefined)[]): boolean {
  return listings.some((each) => [...(each?.values() ?? [])].some((listing) => "error" in listing));
}
