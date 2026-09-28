import type { CertificateLike, IngressLike, SecretLike } from "./types";

/**
 * TLS that cert-manager does not know about.
 *
 * The rest of this extension reads what cert-manager manages, and an absence
 * renders as nothing at all: a certificate no Certificate object stands behind
 * never appears in any of its lists, and nobody renews it. This is the one place
 * that looks from the other side — from what is served, and from what is stored
 * — and asks whether anything is behind it.
 */

export const TLS_SECRET_TYPE = "kubernetes.io/tls";

const CERTIFICATE_NAME = "cert-manager.io/certificate-name";

function isTlsSecret(secret: SecretLike): boolean {
  return secret.type === TLS_SECRET_TYPE;
}

/**
 * The Certificate that writes this Secret. Read from the Certificate's own
 * `secretName` first, because that is the fact; the annotation cert-manager puts
 * on the Secret is the fallback for a Certificate that has since been deleted —
 * and then there is no Certificate, which is the point.
 */
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

/**
 * - `managed`: the Secret exists and a Certificate writes it.
 * - `pending`: it does not exist yet, but a Certificate will write it.
 * - `unmanaged`: it exists, and nothing will renew it.
 * - `missing`: it does not exist, and nothing will create it.
 */
export type ServedState = "managed" | "pending" | "unmanaged" | "missing";

export interface ServedTls {
  ingress: string;
  namespace: string;
  secretName: string;
  hosts: string[];
  state: ServedState;
  certificate?: string;
}

/** Every TLS Secret an Ingress serves, and what stands behind it. */
export function getServedTls(
  ingresses: IngressLike[],
  secrets: SecretLike[],
  certificates: CertificateLike[],
): ServedTls[] {
  const served: ServedTls[] = [];

  for (const ingress of ingresses) {
    const namespace = ingress.getNs() ?? "";

    for (const entry of ingress.spec?.tls ?? []) {
      // A TLS entry without a secret is the controller's default certificate —
      // not something any Secret in the namespace could answer for.
      if (!entry.secretName) continue;

      const secret = secrets.find(
        (each) => each.getNs() === namespace && each.getName() === entry.secretName,
      );
      // A Certificate that will write it counts even before the Secret exists.
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

  const order: Record<ServedState, number> = { unmanaged: 0, missing: 1, pending: 2, managed: 3 };

  return served.sort(
    (first, second) =>
      order[first.state] - order[second.state] ||
      `${first.namespace}/${first.ingress}`.localeCompare(`${second.namespace}/${second.ingress}`),
  );
}

/**
 * TLS Secrets that no Certificate writes, served or not. Informational rather
 * than a gap: other controllers keep TLS Secrets of their own — the API server
 * its serving certificate, admission webhooks theirs — and those are not
 * anyone's oversight. The served ones are what counts; this is the full list.
 */
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
