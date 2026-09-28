import type { CertificateLike, Condition } from "./types";

/**
 * Time, for one certificate. Every function takes `now` so a test can pin it:
 * "expires in six days" has to stay true of a fixture after the six days pass.
 */

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long past its renewal time a still-valid certificate may go before its
 * renewal counts as failing rather than in progress.
 *
 * A healthy renewal from a CA issuer takes seconds; from ACME, a few minutes of
 * challenge propagation. Fifteen is past both. Nothing in the certificate says
 * "failing" on its own: while its request waits on a broken issuer,
 * `failedIssuanceAttempts` stays empty and `Ready` stays true — it has not
 * failed, it has simply not happened — so lateness is the only signal there is.
 */
export const RENEWAL_GRACE_MS = 15 * 60 * 1000;

/** The card's window: what ends within the month. */
export const EXPIRING_DAYS = 30;

/** The alarm colour's window. */
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

/** Milliseconds until `notAfter`: negative once expired, undefined if never issued. */
export function timeLeft(certificate: CertificateLike, now: number): number | undefined {
  const notAfter = timestamp(certificate.status?.notAfter);

  return notAfter === undefined ? undefined : notAfter - now;
}

export function isExpired(certificate: CertificateLike, now: number): boolean {
  const left = timeLeft(certificate, now);

  return left !== undefined && left <= 0;
}

/** Valid, and ending within `days`. An expired certificate is not "expiring". */
export function expiresWithin(certificate: CertificateLike, now: number, days: number): boolean {
  const left = timeLeft(certificate, now);

  return left !== undefined && left > 0 && left <= days * DAY;
}

/**
 * Still valid, still Ready, and past its renewal time by more than the grace.
 * The failure a list of certificates cannot show: everything about it reads as
 * fine until the day it expires.
 */
export function isRenewalOverdue(certificate: CertificateLike, now: number): boolean {
  const renewal = timestamp(certificate.status?.renewalTime);

  if (renewal === undefined || isExpired(certificate, now) || !isReady(certificate)) return false;

  return now - renewal > RENEWAL_GRACE_MS;
}

export interface Validity {
  notBefore: number;
  notAfter: number;
  renewalTime?: number;
  /** Where `now` sits between notBefore and notAfter, clamped to 0..1. */
  position: number;
  /** Where the renewal time sits, on the same scale. */
  renewalPosition?: number;
}

function fraction(value: number, start: number, end: number): number {
  if (end <= start) return 1;

  return Math.min(1, Math.max(0, (value - start) / (end - start)));
}

/** The validity window, for drawing: undefined until the certificate has one. */
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

/** "6 days", "3 hours", "12 minutes" — the largest unit that is at least one. */
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

/** How a certificate's remaining life reads in a row. */
export function describeTimeLeft(certificate: CertificateLike, now: number): string {
  const left = timeLeft(certificate, now);

  if (left === undefined) return "never issued";
  if (left <= 0) return `expired ${describeDuration(left)} ago`;

  return `${describeDuration(left)} left`;
}

/** A moment on a clock no reader can misread: UTC, to the minute. */
export function formatUtc(at: number): string {
  return new Date(at)
    .toISOString()
    .replace("T", " ")
    .replace(/:\d\d\.\d+Z$/, " UTC");
}

/** A moment against now, in its largest whole unit: "in 5 days", "3 hours ago". */
export function describeMoment(at: number, now: number): string {
  const delta = at - now;

  if (Math.abs(delta) < 60 * 1000) return "now";

  return delta > 0 ? `in ${describeDuration(delta)}` : `${describeDuration(delta)} ago`;
}
