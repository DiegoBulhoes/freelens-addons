import { conditionOf, isExpired, isReady, isRenewalOverdue, timeLeft } from "./expiry";
import type { CertificateLike } from "./types";

/**
 * What needs a person, and how badly.
 *
 * Only three things qualify, because the list is for acting on. A certificate
 * that merely ends within the month is not here: one of ninety days, renewing on
 * cert-manager's default, spends its last third inside that window, so a third
 * of all healthy certificates would always be "needing attention". The windows
 * are on the overview's cards instead, where they are information rather than
 * a to-do list.
 */

export type Problem = "expired" | "not-ready" | "renewal-overdue";

export type Severity = "critical" | "warning";

/**
 * Broken now comes before broken later. Expired is serving a certificate every
 * client rejects; not ready has nothing to serve; an overdue renewal is still
 * valid and is the one that will not look broken until the day it is.
 */
const PROBLEMS: Record<Problem, { severity: Severity; rank: number; headline: string }> = {
  expired: { severity: "critical", rank: 0, headline: "Expired" },
  "not-ready": { severity: "critical", rank: 1, headline: "Not ready" },
  "renewal-overdue": { severity: "warning", rank: 2, headline: "Renewal failing" },
};

export function problemOf(certificate: CertificateLike, now: number): Problem | undefined {
  if (isExpired(certificate, now)) return "expired";
  if (!isReady(certificate)) return "not-ready";
  if (isRenewalOverdue(certificate, now)) return "renewal-overdue";

  return undefined;
}

export function severityOf(problem: Problem): Severity {
  return PROBLEMS[problem].severity;
}

export interface AttentionItem {
  certificate: CertificateLike;
  problem: Problem;
  severity: Severity;
  headline: string;
  /** What the certificate itself says; the chain may know more. */
  detail?: string;
}

/** Problems before fine, worse problems first, then less time left, then name. */
export function compareByUrgency(now: number) {
  return (first: CertificateLike, second: CertificateLike): number => {
    const firstProblem = problemOf(first, now);
    const secondProblem = problemOf(second, now);
    const rank = (problem: Problem | undefined) => (problem ? PROBLEMS[problem].rank : 99);

    const byProblem = rank(firstProblem) - rank(secondProblem);

    if (byProblem !== 0) return byProblem;

    // Never issued has no time left at all, so it sorts as if it had none. Compared
    // rather than subtracted: two of them are -Infinity each, and the difference
    // of those is NaN, which sort() reads as neither order.
    const firstLeft = timeLeft(first, now) ?? Number.NEGATIVE_INFINITY;
    const secondLeft = timeLeft(second, now) ?? Number.NEGATIVE_INFINITY;

    if (firstLeft !== secondLeft) return firstLeft < secondLeft ? -1 : 1;

    return `${first.getNs()}/${first.getName()}`.localeCompare(
      `${second.getNs()}/${second.getName()}`,
    );
  };
}

export function getAttentionItems(certificates: CertificateLike[], now: number): AttentionItem[] {
  return certificates
    .filter((certificate) => problemOf(certificate, now) !== undefined)
    .sort(compareByUrgency(now))
    .map((certificate) => {
      const problem = problemOf(certificate, now) as Problem;
      const ready = conditionOf(certificate, "Ready");
      const issuing = conditionOf(certificate, "Issuing");

      return {
        certificate,
        problem,
        severity: PROBLEMS[problem].severity,
        headline: PROBLEMS[problem].headline,
        detail: problem === "renewal-overdue" ? issuing?.message : ready?.message,
      };
    });
}

/** "2 of 9 certificates need attention", with the cases that read differently. */
export function headlineOf(attention: number, total: number): string {
  if (total === 0) return "No certificates";
  if (attention === 0)
    return `All ${total} ${total === 1 ? "certificate is" : "certificates are"} fine`;

  return `${attention} of ${total} ${total === 1 ? "certificate needs" : "certificates need"} attention`;
}
