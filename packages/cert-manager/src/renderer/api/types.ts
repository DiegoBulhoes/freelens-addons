/**
 * The fields of cert-manager's kinds that anything here reads, taken from what a
 * cluster actually returns rather than from the CRD schema. Everything is
 * optional because a freshly created object has no status at all, and the code
 * that reads these has to say something sensible about it.
 */

export interface CertManagerCRD {
  apiVersions: string[];
  plural: string;
  singular: string;
  shortNames?: string[];
  title: string;
}

export type ConditionStatus = "True" | "False" | "Unknown";

export interface Condition {
  type: string;
  status: ConditionStatus;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

/** `kind` is optional in the API and means `Issuer` when absent. */
export interface IssuerRef {
  name: string;
  kind?: string;
  group?: string;
}

export interface CertificateSpec {
  secretName: string;
  issuerRef: IssuerRef;
  dnsNames?: string[];
  commonName?: string;
  duration?: string;
  renewBefore?: string;
  isCA?: boolean;
}

export interface CertificateStatus {
  conditions?: Condition[];
  notBefore?: string;
  notAfter?: string;
  renewalTime?: string;
  revision?: number;
  lastFailureTime?: string;
  failedIssuanceAttempts?: number;
  nextPrivateKeySecretName?: string;
}

export interface CertificateRequestSpec {
  issuerRef: IssuerRef;
  duration?: string;
  isCA?: boolean;
}

export interface CertificateRequestStatus {
  conditions?: Condition[];
  failureTime?: string;
}

export interface IssuerSpec {
  acme?: { server?: string };
  ca?: { secretName?: string };
  selfSigned?: Record<string, unknown>;
  vault?: Record<string, unknown>;
  venafi?: Record<string, unknown>;
}

export interface IssuerStatus {
  conditions?: Condition[];
  acme?: { uri?: string };
}

export interface OrderSpec {
  issuerRef: IssuerRef;
  dnsNames?: string[];
  commonName?: string;
}

/** An ACME order's lifecycle, as cert-manager spells it. */
export type AcmeState =
  | "pending"
  | "ready"
  | "processing"
  | "valid"
  | "errored"
  | "invalid"
  | "expired";

export interface OrderStatus {
  state?: AcmeState;
  reason?: string;
  failureTime?: string;
}

export interface ChallengeSpec {
  dnsName: string;
  type: string;
  issuerRef: IssuerRef;
  wildcard?: boolean;
}

export interface ChallengeStatus {
  state?: AcmeState;
  reason?: string;
  presented?: boolean;
  processing?: boolean;
}

/**
 * The corner of a Kubernetes object the decision modules need. Both the host's
 * own classes and a KubeObject built from a fixture satisfy it, which is what
 * lets those modules be tested without a store.
 */
export interface ObjectLike {
  getName(): string;
  getNs(): string | undefined;
  metadata: {
    uid?: string;
    /** What a write sends back as a precondition, so it cannot overwrite a newer version. */
    resourceVersion?: string;
    generation?: number;
    annotations?: Record<string, string>;
    ownerReferences?: { kind?: string; name?: string; uid?: string }[];
    creationTimestamp?: string;
  };
}

export interface CertificateLike extends ObjectLike {
  spec: CertificateSpec;
  status?: CertificateStatus;
}

export interface CertificateRequestLike extends ObjectLike {
  spec: CertificateRequestSpec;
  status?: CertificateRequestStatus;
}

export interface IssuerLike extends ObjectLike {
  kind: string;
  spec: IssuerSpec;
  status?: IssuerStatus;
}

export interface OrderLike extends ObjectLike {
  spec: OrderSpec;
  status?: OrderStatus;
}

export interface ChallengeLike extends ObjectLike {
  spec: ChallengeSpec;
  status?: ChallengeStatus;
}

/** A Secret, by what it is and who manages it. Never its data. */
export interface SecretLike extends ObjectLike {
  type?: string;
}

export interface IngressLike extends ObjectLike {
  spec?: {
    tls?: { secretName?: string; hosts?: string[] }[];
  };
}
