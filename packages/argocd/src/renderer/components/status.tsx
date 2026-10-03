import type { HealthStatusCode, SyncStatusCode } from "../api/types";

export function HealthBadge({ status, message }: { status: HealthStatusCode; message?: string }) {
  return (
    <span
      className={`ArgoCD-badge ArgoCD-badge--${status}`}
      title={message ? `${status}: ${message}` : status}
    >
      <span aria-hidden="true" className="ArgoCD-badge__dot" />
      {status}
    </span>
  );
}

export function SyncBadge({ status, detail }: { status: SyncStatusCode; detail?: string }) {
  return (
    <span
      className={`ArgoCD-badge ArgoCD-badge--${status}`}
      title={detail ? `${status}: ${detail}` : status}
    >
      <span aria-hidden="true" className="ArgoCD-badge__dot" />
      {status}
    </span>
  );
}

export type Tone = "critical" | "warning" | "info" | "ok";

export function Status({ tone, label, title }: { tone?: Tone; label: string; title?: string }) {
  return (
    <span className={`ArgoCD-status${tone ? ` ArgoCD-status--${tone}` : ""}`} title={title}>
      {label}
    </span>
  );
}
