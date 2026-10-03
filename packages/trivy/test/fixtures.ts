import {
  ClusterRbacAssessmentReport,
  ConfigAuditReport,
  ExposedSecretReport,
  RbacAssessmentReport,
  SbomReport,
  VulnerabilityReport,
} from "../src/renderer/api/reports";
import type { PodLike } from "../src/renderer/api/workload-pods";
import clusterRbacJson from "./fixtures/cluster-rbac-reports.json";
import configAuditJson from "./fixtures/config-audit-reports.json";
import exposedSecretJson from "./fixtures/exposed-secret-reports.json";
import podsJson from "./fixtures/pods.json";
import rbacJson from "./fixtures/rbac-reports.json";
import sbomJson from "./fixtures/sbom-reports.json";
import vulnerabilityJson from "./fixtures/vulnerability-reports.json";

// Taken while the scan job was failing: most workloads have an SBOM and no verdict.

type Raw = { items: unknown[] };

function build<T>(Kind: new (data: never) => T, json: unknown): T[] {
  return (json as Raw).items.map((item) => new Kind(item as never));
}

export function vulnerabilityReports(): VulnerabilityReport[] {
  return build(VulnerabilityReport, vulnerabilityJson);
}

export function configAuditReports(): ConfigAuditReport[] {
  return build(ConfigAuditReport, configAuditJson);
}

export function sbomReports(): SbomReport[] {
  return build(SbomReport, sbomJson);
}

export function exposedSecretReports(): ExposedSecretReport[] {
  return build(ExposedSecretReport, exposedSecretJson);
}

export function rbacReports(): RbacAssessmentReport[] {
  return build(RbacAssessmentReport, rbacJson);
}

export function clusterRbacReports(): ClusterRbacAssessmentReport[] {
  return build(ClusterRbacAssessmentReport, clusterRbacJson);
}

export function allRbacReports() {
  return [...rbacReports(), ...clusterRbacReports()];
}

// Built by hand: the host's Pod constructor rejects fields nothing here reads.
export function pods(): PodLike[] {
  return (podsJson as Raw).items.map((raw) => {
    const item = raw as RawPod;

    return {
      getName: () => item.metadata.name,
      getNs: () => item.metadata.namespace,
      getOwnerRefs: () => item.metadata.ownerReferences ?? [],
      getLabels: () =>
        Object.entries(item.metadata.labels ?? {}).map(([key, value]) => `${key}=${value}`),
      getNodeName: () => item.spec?.nodeName,
      selfLink: item.metadata.selfLink,
      status: item.status,
    };
  });
}

interface RawPod {
  metadata: {
    name: string;
    namespace?: string;
    selfLink?: string;
    labels?: Record<string, string>;
    ownerReferences?: { kind?: string; name?: string }[];
  };
  spec?: { nodeName?: string };
  status?: { phase?: string; startTime?: string };
}

export function allVulnerabilities() {
  return vulnerabilityReports().flatMap((report) => report.report?.vulnerabilities ?? []);
}

export function fixtureNow(): number {
  let newest = 0;

  for (const report of vulnerabilityReports()) {
    const stamp = report.report?.updateTimestamp;
    const parsed = stamp ? Date.parse(stamp) : Number.NaN;

    if (!Number.isNaN(parsed) && parsed > newest) newest = parsed;
  }

  return newest;
}

export function reportNamed(name: string): VulnerabilityReport {
  const found = vulnerabilityReports().find((report) => report.getName() === name);

  if (!found) throw new Error(`no VulnerabilityReport named ${name} in the fixtures`);

  return found;
}
