import { type ListingState, listingBanner } from "../api/shared/listing";
import type { TlsInventory } from "../hooks/use-tls-inventory";

export function ListingBanner(props: ListingState) {
  const banner = listingBanner(props);

  if (!banner) return null;

  return (
    <div className="CertManager-banner CertManager-banner--critical" data-section="listing">
      <span className="CertManager-banner__title">{banner.title}</span>
      <span className="CertManager-banner__body">{banner.body}</span>
    </div>
  );
}

export function SecretsRefusedBanner({
  refused,
}: {
  refused: NonNullable<TlsInventory["secretsRefused"]>;
}) {
  return (
    <div className="CertManager-banner CertManager-banner--critical">
      <span className="CertManager-banner__title">
        {refused.everywhere
          ? "TLS Secrets could not be listed."
          : `TLS Secrets could not be listed in ${refused.namespaces.join(", ")}.`}
      </span>
      <span className="CertManager-banner__body">
        {refused.error}. Without them, whether a served Secret there exists is not known; listing
        them needs permission to list Secrets. They are listed again every 30 seconds.
      </span>
    </div>
  );
}
