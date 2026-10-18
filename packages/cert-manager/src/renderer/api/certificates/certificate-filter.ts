import { CERTIFICATES_UNKNOWN } from "../shared/listing";
import { describeLoadState, type LoadState } from "../shared/store-state";
import type { CertificateLike } from "../shared/types";
import { compareByUrgency, problemOf } from "./attention";
import { EXPIRING_DAYS, expiresWithin, isOutOfDate, isReady, isRenewalOverdue } from "./expiry";

export type CertificateFilter =
  | "all"
  | "attention"
  | "expiring"
  | "failing"
  | "not-ready"
  | "out-of-date";

/** One wording for every window: the chip, the cards and the drawer. */
export function endsWithinLabel(days: number): string {
  return `Ends within ${days} days`;
}

export const FILTER_LABELS: Record<CertificateFilter, string> = {
  all: "All",
  attention: "Needs attention",
  expiring: endsWithinLabel(EXPIRING_DAYS),
  failing: "Renewal failing",
  "not-ready": "Not ready",
  "out-of-date": "Out of date",
};

export const FILTER_TITLES: Record<CertificateFilter, string> = {
  all: "Shows every certificate in the namespaces chosen",
  attention: "Shows the certificates that are expired, not ready, out of date or failing to renew",
  expiring: `Shows the certificates that end within ${EXPIRING_DAYS} days`,
  failing: "Shows the certificates still valid whose renewal is failing",
  "not-ready": "Shows the certificates with nothing ready to serve",
  "out-of-date":
    "Shows the certificates still serving a valid previous certificate while a new one is not ready",
};

export function isCertificateFilter(value: string): value is CertificateFilter {
  return Object.hasOwn(FILTER_LABELS, value);
}

export function matchesFilter(
  certificate: CertificateLike,
  filter: CertificateFilter,
  now: number,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "attention":
      return problemOf(certificate, now) !== undefined;
    case "expiring":
      return expiresWithin(certificate, now, EXPIRING_DAYS);
    case "failing":
      return isRenewalOverdue(certificate, now);
    case "not-ready":
      return !isReady(certificate) && !isOutOfDate(certificate, now);
    case "out-of-date":
      return isOutOfDate(certificate, now);
  }
}

export function certificateSearchTexts(certificate: CertificateLike): string[] {
  return [
    certificate.getName(),
    certificate.getNs() ?? "",
    certificate.spec.secretName,
    certificate.spec.commonName ?? "",
    certificate.spec.issuerRef.name,
    ...(certificate.spec.dnsNames ?? []),
  ];
}

export function certificateNames(certificate: CertificateLike): string {
  return (certificate.spec.dnsNames ?? []).join(", ") || certificate.spec.commonName || "—";
}

export function matchesSearch(certificate: CertificateLike, text: string): boolean {
  const needle = text.trim().toLowerCase();

  if (!needle) return true;

  return certificateSearchTexts(certificate).some((value) => value.toLowerCase().includes(needle));
}

export function selectCertificates(
  certificates: CertificateLike[],
  filter: CertificateFilter,
  text: string,
  now: number,
): CertificateLike[] {
  return certificates
    .filter(
      (certificate) => matchesFilter(certificate, filter, now) && matchesSearch(certificate, text),
    )
    .sort(compareByUrgency(now));
}

/** A refused list reads loaded and empty, so "there is no Certificate" waits for a real one. */
export function certificatesEmptyText(
  state: LoadState,
  certificatesKnown: boolean,
  total: number,
): string {
  const loading = describeLoadState(state);

  if (loading) return loading;
  if (!certificatesKnown) return CERTIFICATES_UNKNOWN;

  return total === 0
    ? "There is no Certificate in the namespaces chosen in the selector."
    : "No certificate matches that filter.";
}
