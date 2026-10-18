import type { ChainLink } from "../certificates/chain";
import { describeMoment, isIssuing, parsedTime } from "../certificates/expiry";
import type { CertificateLike, CertificateSpec, Condition } from "../shared/types";

// What `cmctl renew` does: set Issuing true. cert-manager reissues, with a new key under rotationPolicy Always.

export const MANUAL_TRIGGER = {
  reason: "ManuallyTriggered",
  message: "Certificate re-issuance manually triggered",
} as const;

// cert-manager's default, without either field, renews two thirds into the lifetime.
export function renewalPhrase(spec: CertificateSpec): string {
  if (spec.renewBefore) return `${spec.renewBefore} before the end`;
  if (spec.renewBeforePercentage !== undefined) {
    return `when ${spec.renewBeforePercentage}% of its lifetime is left`;
  }

  return "at two thirds";
}

export type RenewalVerdict = { offer: true; warning?: string } | { offer: false; reason: string };

// Not while already issuing: a second trigger changes nothing.
export function renewalVerdict(
  certificate: CertificateLike,
  explanation: ChainLink | undefined,
): RenewalVerdict {
  const blocker = explanation ? `${explanation.kind} ${explanation.name}` : undefined;

  if (isIssuing(certificate)) {
    return {
      offer: false,
      reason: blocker
        ? `cert-manager is already issuing it, so renewing again does nothing. It is held up by ${blocker}.`
        : "cert-manager is already issuing it, so renewing again does nothing.",
    };
  }

  const issuerBroken =
    explanation !== undefined &&
    (explanation.kind === "Issuer" || explanation.kind === "ClusterIssuer") &&
    explanation.state !== "ok";

  return issuerBroken
    ? {
        offer: true,
        warning: `Its issuer is not usable (${blocker}), so the renewal will fail until that is fixed.`,
      }
    : { offer: true };
}

const HOUR = 60 * 60 * 1000;

// cert-manager's trigger controller: an hour after the first failure, doubled each time, at most 32.
export function backoffAfter(attempts: number): number {
  return Math.min(HOUR * 2 ** Math.max(attempts - 1, 0), 32 * HOUR);
}

export interface IssuanceFailures {
  attempts: number;
  lastFailure: number;
  nextTry: number;
}

export function issuanceFailuresOf(certificate: CertificateLike): IssuanceFailures | undefined {
  const lastFailure = parsedTime(certificate.status?.lastFailureTime);

  if (lastFailure === undefined) return undefined;

  // Older cert-manager set only lastFailureTime, and waited an hour.
  const attempts = certificate.status?.failedIssuanceAttempts ?? 1;

  return { attempts, lastFailure, nextTry: lastFailure + backoffAfter(attempts) };
}

export function describeFailures(failures: IssuanceFailures, now: number): string {
  const tried = `${failures.attempts} failed ${failures.attempts === 1 ? "attempt" : "attempts"}, the last ${describeMoment(failures.lastFailure, now)}`;

  return failures.nextTry > now
    ? `${tried}. cert-manager tries again ${describeMoment(failures.nextTry, now)}, or sooner if its spec changes.`
    : `${tried}. The wait is over, so cert-manager tries again now.`;
}

/** The drawer's Renew now fact. */
export function renewNowNote(
  verdict: RenewalVerdict,
  failures: IssuanceFailures | undefined,
  now: number,
): string {
  if (!verdict.offer) return verdict.reason;

  const skip =
    failures && failures.nextTry > now
      ? "Renewing now tries at once, without waiting for cert-manager's next try."
      : undefined;

  return [verdict.warning, skip].filter(Boolean).join(" ") || "Offered in the title bar.";
}

export interface RenewalPatch {
  metadata: { resourceVersion?: string };
  status: { conditions: Condition[] };
}

// A merge patch replaces the list whole, so every condition is sent, with the
// resourceVersion so a concurrent status write is refused with 409.
export function renewalPatch(certificate: CertificateLike, now: number): RenewalPatch {
  const others = (certificate.status?.conditions ?? []).filter((each) => each.type !== "Issuing");
  const issuing: Condition & { observedGeneration?: number } = {
    type: "Issuing",
    status: "True",
    reason: MANUAL_TRIGGER.reason,
    message: MANUAL_TRIGGER.message,
    lastTransitionTime: new Date(now).toISOString().replace(/\.\d+Z$/, "Z"),
  };

  if (certificate.metadata.generation !== undefined) {
    issuing.observedGeneration = certificate.metadata.generation;
  }

  return {
    metadata: { resourceVersion: certificate.metadata.resourceVersion },
    status: { conditions: [...others, issuing] },
  };
}

export function statusPath(certificate: CertificateLike): string {
  return `/apis/cert-manager.io/v1/namespaces/${certificate.getNs()}/certificates/${certificate.getName()}/status`;
}

export function describeRefusal(status: number, message: string | undefined): string {
  if (status === 403) {
    return "Not allowed: renewing needs permission to patch certificates/status.";
  }

  if (status === 409) {
    return "It changed while you were looking at it. Nothing was written. Try again.";
  }

  return `The API server refused (${status})${message ? `: ${message}` : "."}`;
}
