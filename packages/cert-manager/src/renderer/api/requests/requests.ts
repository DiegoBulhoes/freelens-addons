import { conditionOf } from "../certificates/expiry";
import { CERTIFICATE_NAME, REVISION } from "../shared/annotations";
import type { Condition } from "../shared/types";

// Narrower than CertificateRequestLike so the host's class fits: its annotations are Partial.
export interface RequestFields {
  metadata: { annotations?: Partial<Record<string, string>> };
  status?: { conditions?: Condition[] };
}

export function certificateOfRequest(request: RequestFields): string {
  return request.metadata.annotations?.[CERTIFICATE_NAME] ?? "";
}

/** The certificates page's route to the request's Certificate, which shares its namespace. */
export function certificateRouteOf(
  request: RequestFields & { getNs(): string | undefined },
): { namespace: string; name: string } | undefined {
  const name = certificateOfRequest(request);

  return name ? { namespace: request.getNs() ?? "", name } : undefined;
}

export function revisionOfRequest(request: RequestFields): number {
  return Number(request.metadata.annotations?.[REVISION] ?? 0);
}

export interface RequestState {
  label: string;
  tone?: "critical" | "warning" | "ok";
  message?: string;
}

export const AWAITING_APPROVAL =
  "No approver has approved it, so no issuer will sign it. cert-manager's own approver does so at once; with approver-policy, a CertificateRequestPolicy must allow it.";

// Issuers act only on an Approved request, and leave Ready unset or Pending until then.
export function isAwaitingApproval(request: RequestFields): boolean {
  const settled = ["Approved", "Denied", "InvalidRequest"].some(
    (type) => conditionOf(request, type)?.status === "True",
  );
  const ready = conditionOf(request, "Ready");

  return !settled && ready?.status !== "True" && ready?.reason !== "Failed";
}

// Denial first: a denied request's Ready condition may still say Pending.
export function requestStateOf(request: RequestFields): RequestState {
  const denied = conditionOf(request, "Denied");

  if (denied?.status === "True") {
    return { label: "Denied", tone: "critical", message: denied.message };
  }

  if (isAwaitingApproval(request)) {
    return { label: "Awaiting approval", tone: "warning", message: AWAITING_APPROVAL };
  }

  const ready = conditionOf(request, "Ready");

  if (!ready) return { label: "Unknown" };

  const label = ready.reason ?? (ready.status === "True" ? "Issued" : "Unknown");

  if (ready.status === "True") return { label, tone: "ok", message: ready.message };
  if (ready.reason === "Failed") return { label, tone: "critical", message: ready.message };

  return { label, tone: "warning", message: ready.message };
}
