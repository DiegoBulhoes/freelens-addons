import type { CertificateLike, Condition } from "./types";

const DAY = 24 * 60 * 60 * 1000;

// Lateness is the only signal: a renewal stuck on a broken issuer stays Ready with no
// failed attempts. Fifteen minutes is past ACME propagation.
export const RENEWAL_GRACE_MS = 15 * 60 * 1000;

export const EXPIRING_DAYS = 30;

export const ALARM_DAYS = 7;

export function conditionOf(
  object: { status?: { conditions?: Condition[] } },
  type: string,
): Condition | undefined {
  return object.status?.conditions?.find((each) => each.type === type);
}

export function isReady(certificate: CertificateLike): boolean {
  return conditionOf(certificate, "Ready")?.status === "True";
}

export function isIssuing(certificate: CertificateLike): boolean {
  return conditionOf(certificate, "Issuing")?.status === "True";
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? undefined : parsed;
}

export function timeLeft(certificate: CertificateLike, now: number): number | undefined {
  const notAfter = timestamp(certificate.status?.notAfter);

  return notAfter === undefined ? undefined : notAfter - now;
}

export function isExpired(certificate: CertificateLike, now: number): boolean {
  const left = timeLeft(certificate, now);

  return left !== undefined && left <= 0;
}

export function expiresWithin(certificate: CertificateLike, now: number, days: number): boolean {
  const left = timeLeft(certificate, now);

  return left !== undefined && left > 0 && left <= days * DAY;
}

export function isRenewalOverdue(certificate: CertificateLike, now: number): boolean {
  const renewal = timestamp(certificate.status?.renewalTime);

  if (renewal === undefined || isExpired(certificate, now) || !isReady(certificate)) return false;

  return now - renewal > RENEWAL_GRACE_MS;
}

export interface Validity {
  notBefore: number;
  notAfter: number;
  renewalTime?: number;
  position: number;
  renewalPosition?: number;
}

function fraction(value: number, start: number, end: number): number {
  if (end <= start) return 1;

  return Math.min(1, Math.max(0, (value - start) / (end - start)));
}

export function validityOf(certificate: CertificateLike, now: number): Validity | undefined {
  const notBefore = timestamp(certificate.status?.notBefore);
  const notAfter = timestamp(certificate.status?.notAfter);

  if (notBefore === undefined || notAfter === undefined) return undefined;

  const renewalTime = timestamp(certificate.status?.renewalTime);

  return {
    notBefore,
    notAfter,
    renewalTime,
    position: fraction(now, notBefore, notAfter),
    renewalPosition:
      renewalTime === undefined ? undefined : fraction(renewalTime, notBefore, notAfter),
  };
}

export function describeDuration(milliseconds: number): string {
  const magnitude = Math.abs(milliseconds);
  const units: [number, string][] = [
    [DAY, "day"],
    [60 * 60 * 1000, "hour"],
    [60 * 1000, "minute"],
  ];

  for (const [size, name] of units) {
    const count = Math.floor(magnitude / size);

    if (count >= 1) return `${count} ${name}${count === 1 ? "" : "s"}`;
  }

  return "less than a minute";
}

export function describeTimeLeft(certificate: CertificateLike, now: number): string {
  const left = timeLeft(certificate, now);

  if (left === undefined) return "never issued";
  if (left <= 0) return `expired ${describeDuration(left)} ago`;

  return `${describeDuration(left)} left`;
}

export function formatUtc(at: number): string {
  return new Date(at)
    .toISOString()
    .replace("T", " ")
    .replace(/:\d\d\.\d+Z$/, " UTC");
}

export function describeMoment(at: number, now: number): string {
  const delta = at - now;

  if (Math.abs(delta) < 60 * 1000) return "now";

  return delta > 0 ? `in ${describeDuration(delta)}` : `${describeDuration(delta)} ago`;
}
