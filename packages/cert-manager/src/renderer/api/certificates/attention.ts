import { keyOf } from "../shared/namespace-scope";
import type { CertificateLike } from "../shared/types";
import type { Verdict } from "../shared/verdict";
import type { ChainLink } from "./chain";
import {
  ALARM_DAYS,
  conditionOf,
  describeMoment,
  describeTimeLeft,
  expiresWithin,
  isExpired,
  isOutOfDate,
  isReady,
  isRenewalOverdue,
  renewalTimeOf,
  timeLeft,
} from "./expiry";

// Only what needs acting on. "Ends this month" is left to the cards: a healthy
// 90-day certificate spends its last third inside that window.

export type Problem = "expired" | "not-ready" | "out-of-date" | "renewal-overdue";

export type Severity = "critical" | "warning";

const PROBLEMS: Record<Problem, { severity: Severity; rank: number; headline: string }> = {
  expired: { severity: "critical", rank: 0, headline: "Expired" },
  "not-ready": { severity: "critical", rank: 1, headline: "Not ready" },
  "out-of-date": { severity: "warning", rank: 2, headline: "Out of date" },
  "renewal-overdue": { severity: "warning", rank: 3, headline: "Renewal failing" },
};

export function problemOf(certificate: CertificateLike, now: number): Problem | undefined {
  if (isExpired(certificate, now)) return "expired";
  if (isOutOfDate(certificate, now)) return "out-of-date";
  if (!isReady(certificate)) return "not-ready";
  if (isRenewalOverdue(certificate, now)) return "renewal-overdue";

  return undefined;
}

// An out-of-date certificate becomes an outage once what it still serves is about to end.
export function problemSeverity(
  certificate: CertificateLike,
  problem: Problem,
  now: number,
): Severity {
  return problem === "out-of-date" && expiresWithin(certificate, now, ALARM_DAYS)
    ? "critical"
    : PROBLEMS[problem].severity;
}

export function certificateStatusOf(
  certificate: CertificateLike,
  now: number,
): { label: string; tone: Severity | "ok" } {
  const problem = problemOf(certificate, now);

  return problem
    ? { label: PROBLEMS[problem].headline, tone: problemSeverity(certificate, problem, now) }
    : { label: "Ready", tone: "ok" };
}

const PROBLEM_SENTENCES: Record<Problem, (certificate: CertificateLike, now: number) => string> = {
  expired: () => "Expired. Clients reject it.",
  "not-ready": () => "Not ready: there is no certificate to serve.",
  "out-of-date": (certificate, now) =>
    `Out of date: no certificate matching its spec is ready, so the previous one is still served, ${describeTimeLeft(certificate, now)}.`,
  "renewal-overdue": () =>
    "Still valid, but its renewal is failing. It will expire unless the cause is fixed.",
};

/** The drawer's banner: what is wrong, and the link in the chain that explains it. */
export function certificateVerdict(
  certificate: CertificateLike,
  explanation: ChainLink | undefined,
  now: number,
): Verdict {
  const problem = problemOf(certificate, now);

  if (problem) {
    return {
      tone: problemSeverity(certificate, problem, now),
      label: PROBLEM_SENTENCES[problem](certificate, now),
      reason: explanation?.reason
        ? `${explanation.kind} ${explanation.name}: ${explanation.reason}`
        : (conditionOf(certificate, "Ready")?.message ?? "Nothing in its chain says why."),
    };
  }

  const renewal = renewalTimeOf(certificate);

  return {
    tone: "ok",
    label: "Ready",
    reason: `Ready, ${describeTimeLeft(certificate, now)}.${
      renewal === undefined ? "" : ` Renewal due ${describeMoment(renewal, now)}.`
    }`,
  };
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

    return keyOf(first).localeCompare(keyOf(second));
  };
}

export function getAttentionItems(certificates: CertificateLike[], now: number): AttentionItem[] {
  const byUrgency = compareByUrgency(now);

  return certificates
    .flatMap((certificate) => {
      const problem = problemOf(certificate, now);

      return problem ? [{ certificate, problem }] : [];
    })
    .sort((first, second) => byUrgency(first.certificate, second.certificate))
    .map(({ certificate, problem }) => {
      const ready = conditionOf(certificate, "Ready");
      const issuing = conditionOf(certificate, "Issuing");

      return {
        certificate,
        problem,
        severity: problemSeverity(certificate, problem, now),
        headline: PROBLEMS[problem].headline,
        detail: problem === "renewal-overdue" ? issuing?.message : ready?.message,
      };
    });
}

export function describeHeadline(attention: number, total: number, listed = true): string {
  if (!listed) return "Certificates could not be listed";
  if (total === 0) return "No certificates";
  if (attention === 0)
    return `All ${total} ${total === 1 ? "certificate is" : "certificates are"} fine`;

  return `${attention} of ${total} ${total === 1 ? "certificate needs" : "certificates need"} attention`;
}
