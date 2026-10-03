import { Renderer } from "@freelensapp/extensions";

import type {
  CertificateRequestSpec,
  CertificateRequestStatus,
  CertificateSpec,
  CertificateStatus,
  CertManagerCRD,
  ChallengeSpec,
  ChallengeStatus,
  IssuerSpec,
  IssuerStatus,
  OrderSpec,
  OrderStatus,
} from "./types";

const CORE = "cert-manager.io/v1";
const ACME = "acme.cert-manager.io/v1";

type Metadata = Renderer.K8sApi.KubeObjectMetadata;

export class Certificate extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  CertificateStatus,
  CertificateSpec
> {
  static override readonly kind = "Certificate";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${CORE}/certificates`;

  static override readonly crd: CertManagerCRD = {
    apiVersions: [CORE],
    plural: "certificates",
    singular: "certificate",
    shortNames: ["cert", "certs"],
    title: "Certificates",
  };
}

export class CertificateRequest extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  CertificateRequestStatus,
  CertificateRequestSpec
> {
  static override readonly kind = "CertificateRequest";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${CORE}/certificaterequests`;

  static override readonly crd: CertManagerCRD = {
    apiVersions: [CORE],
    plural: "certificaterequests",
    singular: "certificaterequest",
    shortNames: ["cr", "crs"],
    title: "Certificate Requests",
  };
}

export class Issuer extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  IssuerStatus,
  IssuerSpec
> {
  static override readonly kind = "Issuer";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${CORE}/issuers`;

  static override readonly crd: CertManagerCRD = {
    apiVersions: [CORE],
    plural: "issuers",
    singular: "issuer",
    title: "Issuers",
  };
}

export class ClusterIssuer extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  IssuerStatus,
  IssuerSpec
> {
  static override readonly kind = "ClusterIssuer";
  static override readonly namespaced = false;
  static override readonly apiBase = `/apis/${CORE}/clusterissuers`;

  static override readonly crd: CertManagerCRD = {
    apiVersions: [CORE],
    plural: "clusterissuers",
    singular: "clusterissuer",
    title: "Cluster Issuers",
  };
}

export class Order extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  OrderStatus,
  OrderSpec
> {
  static override readonly kind = "Order";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${ACME}/orders`;

  static override readonly crd: CertManagerCRD = {
    apiVersions: [ACME],
    plural: "orders",
    singular: "order",
    title: "Orders",
  };
}

export class Challenge extends Renderer.K8sApi.LensExtensionKubeObject<
  Metadata,
  ChallengeStatus,
  ChallengeSpec
> {
  static override readonly kind = "Challenge";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${ACME}/challenges`;

  static override readonly crd: CertManagerCRD = {
    apiVersions: [ACME],
    plural: "challenges",
    singular: "challenge",
    title: "Challenges",
  };
}
