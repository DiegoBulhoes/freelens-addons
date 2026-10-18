import { reasonOf } from "../shared/errors";
import type { SubjectBearing } from "../shared/subjects";

// Coverage reads only an SBOM's labels; its body, megabytes per image, is never fetched.

export const METADATA_ONLY = "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1";

export function sbomListPath(namespace: string): string {
  return `/apis/aquasecurity.github.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/sbomreports`;
}

export interface PartialObjectMetadataList {
  items?: {
    metadata?: {
      name?: string;
      namespace?: string;
      labels?: Record<string, string>;
      ownerReferences?: { name: string }[];
    };
  }[];
}

export interface SbomSubject extends SubjectBearing {
  getNs(): string | undefined;
}

export function sbomSubjectsFrom(list: PartialObjectMetadataList): SbomSubject[] {
  return (list.items ?? []).flatMap((item) => {
    const metadata = item.metadata;

    if (!metadata?.name) return [];

    const labels = Object.entries(metadata.labels ?? {}).map(([key, value]) => `${key}=${value}`);
    const owners = (metadata.ownerReferences ?? []).map((owner) => ({ name: owner.name }));
    const namespace = metadata.namespace;

    return [{ getNs: () => namespace, getLabels: () => labels, getOwnerRefs: () => owners }];
  });
}

/** One namespace's SBOM subjects, or why the list was refused. */
export type SbomListing = readonly SbomSubject[] | { error: string };

export type SbomListings = ReadonlyMap<string, SbomListing>;

/** Each namespace's own outcome: one refused namespace leaves the others listed. */
export function settledSbomListings(
  namespaces: readonly string[],
  results: readonly PromiseSettledResult<PartialObjectMetadataList>[],
): Map<string, SbomListing> {
  return new Map(
    namespaces.map((namespace, at): [string, SbomListing] => {
      const result = results[at];

      if (result?.status === "fulfilled") return [namespace, sbomSubjectsFrom(result.value)];

      return [namespace, { error: result ? reasonOf(result.reason) : "not listed" }];
    }),
  );
}

const isRefused = (listing: SbomListing | undefined): listing is { error: string } =>
  listing !== undefined && "error" in listing;

/** A refused re-list keeps what the namespace listed before, so a passing error does not blank it. */
export function mergeSbomListings(
  before: SbomListings,
  after: SbomListings,
): Map<string, SbomListing> {
  const merged = new Map(before);

  for (const [namespace, listing] of after) {
    const kept = merged.get(namespace);

    merged.set(namespace, isRefused(listing) && kept && !isRefused(kept) ? kept : listing);
  }

  return merged;
}

export function sbomSubjectsIn(
  listings: SbomListings,
  namespaces: readonly string[],
): SbomSubject[] {
  return namespaces.flatMap((namespace) => {
    const listing = listings.get(namespace);

    return listing && !isRefused(listing) ? [...listing] : [];
  });
}

/** The namespaces with no SBOM listing at all, only a refusal. */
export function refusedIn(listings: SbomListings, namespaces: readonly string[]): string[] {
  return namespaces.filter((namespace) => isRefused(listings.get(namespace)));
}
