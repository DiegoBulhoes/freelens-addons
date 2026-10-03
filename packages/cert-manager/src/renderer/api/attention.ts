import { conditionOf, isExpired, isReady, isRenewalOverdue, timeLeft } from "./expiry";
import type { CertificateLike } from "./types";

// Only what needs acting on. "Ends this month" is left to the cards: a healthy
// 90-day certificate spends its last third inside that window.

export type Problem = "expired" | "not-ready" | "renewal-overdue";

export type Severity = "critical" | "warning";

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

export function certificateStatusOf(
  certificate: CertificateLike,
  now: number,
): { label: string; tone: Severity | "ok" } {
  const problem = problemOf(certificate, now);

  return problem
    ? { label: PROBLEMS[problem].headline, tone: PROBLEMS[problem].severity }
    : { label: "Ready", tone: "ok" };
}

export interface AttentionItem {
  certificate: CertificateLike;
  problem: Problem;
  severity: Severity;
  headline: string;
  detail?: string;
}

export function compareByUrgency(now: number) {
  return (first: CertificateLike, second: CertificateLike): number => {
    const firstProblem = problemOf(first, now);
    const secondProblem = problemOf(second, now);
    const rank = (problem: Problem | undefined) => (problem ? PROBLEMS[problem].rank : 99);

    const byProblem = rank(firstProblem) - rank(secondProblem);

    if (byProblem !== 0) return byProblem;

    // Compared, not subtracted: -Infinity - -Infinity is NaN, which breaks sort().
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

export function headlineOf(attention: number, total: number): string {
  if (total === 0) return "No certificates";
  if (attention === 0)
    return `All ${total} ${total === 1 ? "certificate is" : "certificates are"} fine`;

  return `${attention} of ${total} ${total === 1 ? "certificate needs" : "certificates need"} attention`;
}
