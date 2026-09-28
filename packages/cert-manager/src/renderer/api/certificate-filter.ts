import { compareByUrgency, problemOf } from "./attention";
import { EXPIRING_DAYS, expiresWithin, isReady, isRenewalOverdue } from "./expiry";
import type { CertificateLike } from "./types";

/**
 * The certificate picker's chips and search field, kept out of the page so a
 * test can say what an operator sees. A filter written inline in a page is the
 * one thing nothing can test.
 */

export type CertificateFilter = "all" | "attention" | "expiring" | "failing" | "not-ready";

export const FILTER_LABELS: Record<CertificateFilter, string> = {
  all: "All",
  attention: "Needs attention",
  expiring: `Ends within ${EXPIRING_DAYS} days`,
  failing: "Renewal failing",
  "not-ready": "Not ready",
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
      return !isReady(certificate);
  }
}

/**
 * Name, namespace, the names it covers, the Secret it writes and the issuer it
 * names — the things someone arriving from an alert or a hostname would type.
 */
export function matchesSearch(certificate: CertificateLike, text: string): boolean {
  const needle = text.trim().toLowerCase();

  if (!needle) return true;

  const haystack = [
    certificate.getName(),
    certificate.getNs() ?? "",
    certificate.spec.secretName,
    certificate.spec.commonName ?? "",
    certificate.spec.issuerRef.name,
    ...(certificate.spec.dnsNames ?? []),
  ];

  return haystack.some((value) => value.toLowerCase().includes(needle));
}

/** What the picker lists: filtered, searched, and in order of urgency. */
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
