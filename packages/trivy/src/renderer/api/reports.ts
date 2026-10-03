import { Renderer } from "@freelensapp/extensions";

import type {
  ConfigAuditReportBody,
  ExposedSecretReportBody,
  RbacAssessmentReportBody,
  SbomReportBody,
  TrivyKubeObjectCRD,
  VulnerabilityReportBody,
} from "./types";

const GROUP = "aquasecurity.github.io";
const API_VERSION = `${GROUP}/v1alpha1`;

// The body is `report`, beside `metadata`, so it fits neither status nor spec.
interface Reporting<Body> {
  report?: Body;
}

export class VulnerabilityReport
  extends Renderer.K8sApi.LensExtensionKubeObject<Renderer.K8sApi.KubeObjectMetadata>
  implements Reporting<VulnerabilityReportBody>
{
  static override readonly kind = "VulnerabilityReport";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${API_VERSION}/vulnerabilityreports`;

  static override readonly crd: TrivyKubeObjectCRD = {
    apiVersions: [API_VERSION],
    plural: "vulnerabilityreports",
    singular: "vulnerabilityreport",
    shortNames: ["vuln", "vulns"],
    title: "Vulnerability Reports",
  };

  declare report?: VulnerabilityReportBody;
}

export class ConfigAuditReport
  extends Renderer.K8sApi.LensExtensionKubeObject<Renderer.K8sApi.KubeObjectMetadata>
  implements Reporting<ConfigAuditReportBody>
{
  static override readonly kind = "ConfigAuditReport";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${API_VERSION}/configauditreports`;

  static override readonly crd: TrivyKubeObjectCRD = {
    apiVersions: [API_VERSION],
    plural: "configauditreports",
    singular: "configauditreport",
    shortNames: ["configaudit"],
    title: "Config Audit Reports",
  };

  declare report?: ConfigAuditReportBody;
}

export class RbacAssessmentReport
  extends Renderer.K8sApi.LensExtensionKubeObject<Renderer.K8sApi.KubeObjectMetadata>
  implements Reporting<RbacAssessmentReportBody>
{
  static override readonly kind = "RbacAssessmentReport";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${API_VERSION}/rbacassessmentreports`;

  static override readonly crd: TrivyKubeObjectCRD = {
    apiVersions: [API_VERSION],
    plural: "rbacassessmentreports",
    singular: "rbacassessmentreport",
    shortNames: ["rbacassessment"],
    title: "RBAC Assessment Reports",
  };

  declare report?: RbacAssessmentReportBody;
}

export class ClusterRbacAssessmentReport
  extends Renderer.K8sApi.LensExtensionKubeObject<Renderer.K8sApi.KubeObjectMetadata>
  implements Reporting<RbacAssessmentReportBody>
{
  static override readonly kind = "ClusterRbacAssessmentReport";
  static override readonly namespaced = false;
  static override readonly apiBase = `/apis/${API_VERSION}/clusterrbacassessmentreports`;

  static override readonly crd: TrivyKubeObjectCRD = {
    apiVersions: [API_VERSION],
    plural: "clusterrbacassessmentreports",
    singular: "clusterrbacassessmentreport",
    shortNames: ["clusterrbacassessment"],
    title: "Cluster RBAC Assessment Reports",
  };

  declare report?: RbacAssessmentReportBody;
}

export class SbomReport
  extends Renderer.K8sApi.LensExtensionKubeObject<Renderer.K8sApi.KubeObjectMetadata>
  implements Reporting<SbomReportBody>
{
  static override readonly kind = "SbomReport";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${API_VERSION}/sbomreports`;

  static override readonly crd: TrivyKubeObjectCRD = {
    apiVersions: [API_VERSION],
    plural: "sbomreports",
    singular: "sbomreport",
    shortNames: ["sbom"],
    title: "SBOM Reports",
  };

  declare report?: SbomReportBody;
}

export class ExposedSecretReport
  extends Renderer.K8sApi.LensExtensionKubeObject<Renderer.K8sApi.KubeObjectMetadata>
  implements Reporting<ExposedSecretReportBody>
{
  static override readonly kind = "ExposedSecretReport";
  static override readonly namespaced = true;
  static override readonly apiBase = `/apis/${API_VERSION}/exposedsecretreports`;

  static override readonly crd: TrivyKubeObjectCRD = {
    apiVersions: [API_VERSION],
    plural: "exposedsecretreports",
    singular: "exposedsecretreport",
    shortNames: ["secrets"],
    title: "Exposed Secret Reports",
  };

  declare report?: ExposedSecretReportBody;
}
