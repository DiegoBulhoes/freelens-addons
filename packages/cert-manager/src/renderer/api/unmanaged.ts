import type { CertificateLike, IngressLike, SecretLike } from "./types";

export const TLS_SECRET_TYPE = "kubernetes.io/tls";

const CERTIFICATE_NAME = "cert-manager.io/certificate-name";

function isTlsSecret(secret: SecretLike): boolean {
  return secret.type === TLS_SECRET_TYPE;
}

// secretName first; the Secret's annotation is the fallback for a deleted Certificate.
export function managingCertificateOf(
  secret: SecretLike,
  certificates: CertificateLike[],
): CertificateLike | undefined {
  const byName = certificates.find(
    (certificate) =>
      certificate.getNs() === secret.getNs() && certificate.spec.secretName === secret.getName(),
  );

  if (byName) return byName;

  const named = secret.metadata.annotations?.[CERTIFICATE_NAME];

  return named
    ? certificates.find(
        (certificate) => certificate.getNs() === secret.getNs() && certificate.getName() === named,
      )
    : undefined;
}

export type ServedState = "managed" | "pending" | "unmanaged" | "missing";

export const SERVED_STATES: Record<
  ServedState,
  { label: string; tone: "critical" | "warning" | "ok"; rank: number }
> = {
  unmanaged: { label: "No Certificate", tone: "critical", rank: 0 },
  missing: { label: "Secret missing", tone: "critical", rank: 1 },
  pending: { label: "Being issued", tone: "warning", rank: 2 },
  managed: { label: "Managed", tone: "ok", rank: 3 },
};

export function isGap(served: ServedTls): boolean {
  return served.state === "unmanaged" || served.state === "missing";
}

export function servedSearchTexts(served: ServedTls): string[] {
  return [
    SERVED_STATES[served.state].label,
    served.ingress,
    served.namespace,
    served.secretName,
    served.certificate ?? "",
    ...served.hosts,
  ];
}

export function secretSearchTexts(secret: SecretLike): string[] {
  return [secret.getName(), secret.getNs() ?? ""];
}

export interface ServedTls {
  ingress: string;
  namespace: string;
  secretName: string;
  hosts: string[];
  state: ServedState;
  certificate?: string;
}

export function getServedTls(
  ingresses: IngressLike[],
  secrets: SecretLike[],
  certificates: CertificateLike[],
): ServedTls[] {
  const served: ServedTls[] = [];

  for (const ingress of ingresses) {
    const namespace = ingress.getNs() ?? "";

    for (const entry of ingress.spec?.tls ?? []) {
      // No secretName: the controller's default certificate.
      if (!entry.secretName) continue;

      const secret = secrets.find(
        (each) => each.getNs() === namespace && each.getName() === entry.secretName,
      );
      const writer = certificates.find(
        (certificate) =>
          certificate.getNs() === namespace && certificate.spec.secretName === entry.secretName,
      );
      const manager = secret ? managingCertificateOf(secret, certificates) : writer;

      let state: ServedState;

      if (secret) state = manager ? "managed" : "unmanaged";
      else state = writer ? "pending" : "missing";

      served.push({
        ingress: ingress.getName(),
        namespace,
        secretName: entry.secretName,
        hosts: entry.hosts ?? [],
        state,
        certificate: manager?.getName(),
      });
    }
  }

  return served.sort(
    (first, second) =>
      SERVED_STATES[first.state].rank - SERVED_STATES[second.state].rank ||
      `${first.namespace}/${first.ingress}`.localeCompare(`${second.namespace}/${second.ingress}`),
  );
}

// Not a gap: other controllers (API server, webhooks) keep TLS Secrets of their own.
export function getUnmanagedSecrets(
  secrets: SecretLike[],
  certificates: CertificateLike[],
): SecretLike[] {
  return secrets
    .filter((secret) => isTlsSecret(secret) && !managingCertificateOf(secret, certificates))
    .sort((first, second) =>
      `${first.getNs()}/${first.getName()}`.localeCompare(`${second.getNs()}/${second.getName()}`),
    );
}

export interface TlsVerdict {
  tone: "critical" | "warning" | "info" | "ok";
  label: string;
  reason: string;
}

export function servedVerdict(served: ServedTls): TlsVerdict {
  const { tone, label } = SERVED_STATES[served.state];
  const secret = `Secret ${served.secretName}`;
  const reasons: Record<ServedState, string> = {
    unmanaged: `No Certificate writes ${secret}. Nothing renews it: it is served until it expires.`,
    missing: `${secret} does not exist and no Certificate would write it. The Ingress controller serves its default certificate instead.`,
    pending: `Certificate ${served.certificate} will write ${secret}; it is still being issued.`,
    managed: `Certificate ${served.certificate} writes ${secret} and renews it.`,
  };

  return { tone, label, reason: reasons[served.state] };
}

export function ingressesServing(secret: SecretLike, ingresses: IngressLike[]): string[] {
  return ingresses
    .filter(
      (ingress) =>
        ingress.getNs() === secret.getNs() &&
        (ingress.spec?.tls ?? []).some((entry) => entry.secretName === secret.getName()),
    )
    .map((ingress) => ingress.getName())
    .sort();
}

/** The cert-manager annotations a Secret keeps: the only ones read, and never its data. */
export function annotationsOfInterest(secret: SecretLike): [string, string][] {
  return Object.entries(secret.metadata.annotations ?? {})
    .filter(([key, value]) => key.startsWith("cert-manager.io/") && value !== "")
    .sort(([first], [second]) => first.localeCompare(second));
}

export function secretVerdict(
  secret: SecretLike,
  certificates: CertificateLike[],
  ingresses: IngressLike[],
): TlsVerdict {
  const manager = managingCertificateOf(secret, certificates);

  if (manager) {
    return {
      tone: "ok",
      label: "Managed",
      reason: `Certificate ${manager.getName()} writes it and renews it.`,
    };
  }

  const named = secret.metadata.annotations?.[CERTIFICATE_NAME];
  const why = named
    ? `cert-manager wrote it for Certificate ${named}, which no longer exists in ${secret.getNs()}.`
    : "No Certificate writes it, and no cert-manager annotation names one.";
  const servedBy = ingressesServing(secret, ingresses);

  if (servedBy.length > 0) {
    return {
      tone: "critical",
      label: "Served, not renewed",
      reason: `${why} ${servedBy.length === 1 ? "Ingress" : "Ingresses"} ${servedBy.join(", ")} ${servedBy.length === 1 ? "serves" : "serve"} it, and nothing renews it.`,
    };
  }

  return {
    tone: "info",
    label: "Not served",
    reason: `${why} No Ingress here serves it; another controller, such as the API server or a webhook, may keep it.`,
  };
}
