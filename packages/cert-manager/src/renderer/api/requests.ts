import { conditionOf } from "./expiry";
import type { Condition } from "./types";

// Narrower than CertificateRequestLike so the host's class fits: its annotations are Partial.
export interface RequestFields {
  metadata: { annotations?: Partial<Record<string, string>> };
  status?: { conditions?: Condition[] };
}

const CERTIFICATE_NAME = "cert-manager.io/certificate-name";
const REVISION = "cert-manager.io/certificate-revision";

export function certificateOfRequest(request: RequestFields): string {
  return request.metadata.annotations?.[CERTIFICATE_NAME] ?? "";
}

export function revisionOfRequest(request: RequestFields): number {
  return Number(request.metadata.annotations?.[REVISION] ?? 0);
}

export interface RequestState {
  label: string;
  tone?: "critical" | "warning" | "ok";
  message?: string;
}

// Denial first: a denied request's Ready condition may still say Pending.
export function requestStateOf(request: RequestFields): RequestState {
  const denied = conditionOf(request, "Denied");

  if (denied?.status === "True") {
    return { label: "Denied", tone: "critical", message: denied.message };
  }

  const ready = conditionOf(request, "Ready");

  if (!ready) return { label: "Unknown" };

  const label = ready.reason ?? (ready.status === "True" ? "Issued" : "Unknown");

  if (ready.status === "True") return { label, tone: "ok", message: ready.message };
  if (ready.reason === "Failed") return { label, tone: "critical", message: ready.message };

  return { label, tone: "warning", message: ready.message };
}
