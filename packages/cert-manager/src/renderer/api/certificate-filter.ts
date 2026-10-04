import { compareByUrgency, problemOf } from "./attention";
import { EXPIRING_DAYS, expiresWithin, isReady, isRenewalOverdue } from "./expiry";
import type { CertificateLike } from "./types";

export type CertificateFilter = "all" | "attention" | "expiring" | "failing" | "not-ready";

export const FILTER_LABELS: Record<CertificateFilter, string> = {
  all: "All",
  attention: "Needs attention",
  expiring: `Ends within ${EXPIRING_DAYS} days`,
  failing: "Renewal failing",
  "not-ready": "Not ready",
};

export const FILTER_TITLES: Record<CertificateFilter, string> = {
  all: "Shows every certificate in the namespaces chosen",
  attention: "Shows the certificates that are expired, not ready or failing to renew",
  expiring: `Shows the certificates that end within ${EXPIRING_DAYS} days`,
  failing: "Shows the certificates still valid whose renewal is failing",
  "not-ready": "Shows the certificates with nothing ready to serve",
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
