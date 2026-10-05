import type { ChainLink } from "./chain";
import { isIssuing } from "./expiry";
import type { CertificateLike, Condition } from "./types";

// What `cmctl renew` does: set Issuing true. cert-manager reissues, with a new key under rotationPolicy Always.

export const MANUAL_TRIGGER = {
  reason: "ManuallyTriggered",
  message: "Certificate re-issuance manually triggered",
} as const;

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
