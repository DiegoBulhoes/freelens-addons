import type { ChainLink } from "./chain";
import { isIssuing } from "./expiry";
import type { CertificateLike, Condition } from "./types";

/**
 * Forcing a renewal, decided here and sent from `actions.ts`.
 *
 * It is what `cmctl renew` does: set the Certificate's Issuing condition to true,
 * and cert-manager's trigger controller issues the next revision. Nothing else is
 * touched — not the Secret, not the key — so the certificate being served keeps
 * being served until the new one is ready.
 */

export const MANUAL_TRIGGER = {
  reason: "ManuallyTriggered",
  message: "Certificate re-issuance manually triggered",
} as const;

export type RenewalVerdict = { offer: true; warning?: string } | { offer: false; reason: string };

/**
 * Whether the button should do anything.
 *
 * Not while cert-manager is already issuing: the condition is already true, a
 * second trigger changes nothing, and `cmctl renew` skips such a certificate for
 * the same reason. What the operator needs then is the object holding it up,
 * which is named. And not blindly while the issuer is broken — offered, since a
 * renewal is harmless, but saying it will fail until the issuer is fixed.
 */
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

/**
 * The merge patch for the status subresource. A merge patch replaces a list
 * whole, so it carries every condition the certificate has with Issuing set, and
 * the resourceVersion it was computed from: if cert-manager wrote the status in
 * the meantime, the API server refuses with 409 rather than this overwriting it.
 */
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

/** Where the patch goes: the status subresource, which is the only place conditions can be written. */
export function statusPath(certificate: CertificateLike): string {
  return `/apis/cert-manager.io/v1/namespaces/${certificate.getNs()}/certificates/${certificate.getName()}/status`;
}

/** What to tell the operator when the API server refuses. */
export function describeRefusal(status: number, message: string | undefined): string {
  if (status === 403) {
    return "Not allowed: renewing needs permission to patch certificates/status.";
  }

  if (status === 409) {
    return "It changed while you were looking at it. Nothing was written. Try again.";
  }

  return `The API server refused (${status})${message ? `: ${message}` : "."}`;
}
