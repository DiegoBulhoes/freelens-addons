// All optional: a freshly created object has no status at all.

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
  acme?: { server?: string; email?: string; privateKeySecretRef?: { name?: string } };
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

export interface ObjectLike {
  getName(): string;
  getNs(): string | undefined;
  metadata: {
    uid?: string;
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

// Never its data.
export interface SecretLike extends ObjectLike {
  type?: string;
}

export interface IngressLike extends ObjectLike {
  spec?: {
    tls?: { secretName?: string; hosts?: string[] }[];
  };
}
