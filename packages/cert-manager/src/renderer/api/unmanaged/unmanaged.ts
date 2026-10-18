import { CERT_MANAGER_PREFIX, CERTIFICATE_NAME } from "../shared/annotations";
import { firstBy, type Index } from "../shared/index-by";
import { CERTIFICATES_UNKNOWN } from "../shared/listing";
import { keyOf } from "../shared/namespace-scope";
import { describeLoadState, type LoadState } from "../shared/store-state";
import type { CertificateLike, IngressLike, SecretLike } from "../shared/types";
import type { Verdict } from "../shared/verdict";

export const TLS_SECRET_TYPE = "kubernetes.io/tls";

function isTlsSecret(secret: SecretLike): boolean {
  return secret.type === TLS_SECRET_TYPE;
}

function keyAt(namespace: string | undefined, name: string): string {
  return `${namespace ?? ""}/${name}`;
}

const bySecretName: Index<CertificateLike> = new WeakMap();
const byCertificateName: Index<CertificateLike> = new WeakMap();
const secretsByName: Index<SecretLike> = new WeakMap();

function writerOf(
  namespace: string | undefined,
  secretName: string,
  certificates: CertificateLike[],
): CertificateLike | undefined {
  return firstBy(bySecretName, certificates, (certificate) =>
    keyAt(certificate.getNs(), certificate.spec.secretName),
  ).get(keyAt(namespace, secretName));
}

// secretName first; the Secret's annotation is the fallback for a deleted Certificate.
export function managingCertificateOf(
  secret: SecretLike,
  certificates: CertificateLike[],
): CertificateLike | undefined {
  const byName = writerOf(secret.getNs(), secret.getName(), certificates);

  if (byName) return byName;

  const named = secret.metadata.annotations?.[CERTIFICATE_NAME];

  return named
    ? firstBy(byCertificateName, certificates, (certificate) =>
        keyAt(certificate.getNs(), certificate.getName()),
      ).get(keyAt(secret.getNs(), named))
    : undefined;
}

export type ServedState = "managed" | "pending" | "unmanaged" | "unchecked" | "missing";

export const SERVED_STATES: Record<
  ServedState,
  { label: string; tone: "critical" | "warning" | "ok"; rank: number }
> = {
  unmanaged: { label: "No Certificate", tone: "critical", rank: 0 },
  // Unmanaged or missing, a gap either way; which one waits for the Secrets list.
  unchecked: { label: "No Certificate", tone: "critical", rank: 1 },
  missing: { label: "Secret missing", tone: "critical", rank: 2 },
  pending: { label: "Being issued", tone: "warning", rank: 3 },
  managed: { label: "Managed", tone: "ok", rank: 4 },
};

export function isGap(served: ServedTls): boolean {
  return served.state === "unmanaged" || served.state === "unchecked" || served.state === "missing";
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

// A TLS entry without hosts is the Ingress's default certificate, served for any host.
export type ServedFilter = "all" | "gaps";

export const SERVED_FILTER_LABELS: Record<ServedFilter, string> = {
  all: "All",
  gaps: "No Certificate",
};

export const SERVED_FILTER_TITLES: Record<ServedFilter, string> = {
  all: "Shows every TLS entry the Ingresses serve from a Secret",
  gaps: "Shows the served TLS Secrets no Certificate writes, as the overview's card counts them",
};

export function isServedFilter(value: string): value is ServedFilter {
  return Object.hasOwn(SERVED_FILTER_LABELS, value);
}

export function matchesServedFilter(served: ServedTls, filter: ServedFilter): boolean {
  return filter === "all" || isGap(served);
}

export interface IngressListing {
  state: LoadState;
  refused: boolean;
}

/** Whether "no Ingress serves TLS" can be said: the Ingresses were listed for this scope. */
export function ingressesKnown(ingresses: IngressListing): boolean {
  return ingresses.state === "ready" && !ingresses.refused;
}

export function describeServedHeadline(
  state: LoadState,
  ingresses: IngressListing,
  served: ServedTls[],
  certificatesKnown: boolean,
): string {
  if (state === "connecting" || !ingressesKnown(ingresses) || !certificatesKnown) {
    return "Unmanaged TLS";
  }

  const gaps = served.filter(isGap).length;

  if (served.length === 0) return "No Ingress serves TLS from a Secret";
  if (gaps === 0) {
    return served.length === 1
      ? "The TLS Secret served by an Ingress has a Certificate"
      : `All ${served.length} TLS Secrets served by an Ingress have a Certificate`;
  }

  return `${gaps} of ${served.length} served TLS ${served.length === 1 ? "Secret has" : "Secrets have"} no Certificate`;
}

export function servedEmptyText(
  state: LoadState,
  ingresses: IngressListing,
  certificatesKnown: boolean,
): string {
  const loading = describeLoadState(state);

  if (loading) return loading;
  if (ingresses.state === "connecting") return "Listing the Ingresses…";
  if (!ingressesKnown(ingresses)) return "Not known: the Ingresses could not be listed.";
  if (!certificatesKnown) return CERTIFICATES_UNKNOWN;

  return "No Ingress in the chosen namespaces serves TLS from a Secret.";
}

export interface SecretsRefusal {
  namespaces: string[];
  everywhere: boolean;
}

/** Without the Certificates or the Secrets, "every TLS Secret has a Certificate" is a guess. */
export function unmanagedSecretsEmptyText(
  state: LoadState,
  certificatesKnown: boolean,
  refused: SecretsRefusal | undefined,
): string {
  const loading = describeLoadState(state);

  if (loading) return loading;
  if (!certificatesKnown) return CERTIFICATES_UNKNOWN;
  if (refused?.everywhere) return "Not known: TLS Secrets could not be listed.";
  if (refused) {
    return `Every TLS Secret listed is written by a Certificate; those in ${refused.namespaces.join(", ")} could not be listed.`;
  }

  return "Every TLS Secret in the chosen namespaces is written by a Certificate.";
}

/** An unchecked Secret's namespace was refused, or has not answered its first list. */
export function uncheckedSecretNote(
  served: ServedTls,
  refused: SecretsRefusal | undefined,
): string {
  return refused?.namespaces.includes(served.namespace)
    ? "(could not be listed)"
    : "(not listed yet)";
}

export function hostsOf(served: Pick<ServedTls, "hosts">): string {
  return served.hosts.join(", ") || "Any";
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

const listedEverywhere = () => true;

function secretAt(
  secrets: SecretLike[],
  namespace: string | undefined,
  name: string,
): SecretLike | undefined {
  return firstBy(secretsByName, secrets, (each) => keyAt(each.getNs(), each.getName())).get(
    keyAt(namespace, name),
  );
}

function servedStateOf({
  secret,
  writer,
  manager,
  secretsListed,
}: {
  secret: SecretLike | undefined;
  writer: CertificateLike | undefined;
  manager: CertificateLike | undefined;
  secretsListed: boolean;
}): ServedState {
  if (secret) return manager ? "managed" : "unmanaged";
  // Once issued, cert-manager has written the Secret.
  if (writer) return !secretsListed && writer.status?.notAfter ? "managed" : "pending";

  return secretsListed ? "missing" : "unchecked";
}

/** In a namespace whose Secrets were not listed, an absent Secret is not known to be absent. */
export function getServedTls(
  ingresses: IngressLike[],
  secrets: SecretLike[],
  certificates: CertificateLike[],
  listedIn: (namespace: string) => boolean = listedEverywhere,
): ServedTls[] {
  const served: ServedTls[] = [];

  for (const ingress of ingresses) {
    const namespace = ingress.getNs() ?? "";

    for (const entry of ingress.spec?.tls ?? []) {
      // No secretName: the controller's default certificate.
      if (!entry.secretName) continue;

      const secret = secretAt(secrets, namespace, entry.secretName);
      const writer = writerOf(namespace, entry.secretName, certificates);
      const manager = secret ? managingCertificateOf(secret, certificates) : writer;

      served.push({
        ingress: ingress.getName(),
        namespace,
        secretName: entry.secretName,
        hosts: entry.hosts ?? [],
        state: servedStateOf({ secret, writer, manager, secretsListed: listedIn(namespace) }),
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
    .sort((first, second) => keyOf(first).localeCompare(keyOf(second)));
}

export function servedVerdict(served: ServedTls): Verdict {
  const { tone, label } = SERVED_STATES[served.state];
  const secret = `Secret ${served.secretName}`;
  const reasons: Record<ServedState, string> = {
    unmanaged: `No Certificate writes ${secret}. Nothing renews it: it is served until it expires.`,
    unchecked: `No Certificate writes ${secret}, so nothing renews it. Whether the Secret exists is not known: TLS Secrets have not been listed in ${served.namespace}.`,
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
    .filter(([key, value]) => key.startsWith(CERT_MANAGER_PREFIX) && value !== "")
    .sort(([first], [second]) => first.localeCompare(second));
}

export function secretVerdict(
  secret: SecretLike,
  certificates: CertificateLike[],
  ingresses: IngressLike[],
): Verdict {
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
