import type { CertManagerKind } from "./types";

/** Listed for the unmanaged TLS pages, beside cert-manager's own kinds. */
export type BannerKind = CertManagerKind | "Ingress";

export const CERTIFICATES_UNKNOWN = "Not known: the Certificates could not be listed.";

export interface ListingState {
  /** Kinds whose list was refused or timed out. */
  failed: readonly BannerKind[];
  /** Some list never arrived within the retries. */
  gaveUp: boolean;
}

export function bannerFailures(
  failed: readonly CertManagerKind[],
  ingressListing: { refused: boolean },
): readonly BannerKind[] {
  return ingressListing.refused ? [...failed, "Ingress"] : failed;
}

function plural(kind: BannerKind): string {
  if (kind.endsWith("y")) return `${kind.slice(0, -1)}ies`;

  return kind.endsWith("s") ? `${kind}es` : `${kind}s`;
}

function joined(words: string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** What could not be listed, for a banner; undefined when everything was. */
export function listingBanner(state: ListingState): { title: string; body: string } | undefined {
  if (state.failed.length > 0) {
    return {
      title: `${joined(state.failed.map(plural))} could not be listed.`,
      body: "The API server refused the list or did not answer in time, so they read as none here. What depends on them is shown as unknown, not missing.",
    };
  }

  if (state.gaveUp) {
    return {
      title: "cert-manager's objects did not load.",
      body: "The cluster did not answer within 30 seconds. What is shown may be incomplete; reopen the page to try again.",
    };
  }

  return undefined;
}
