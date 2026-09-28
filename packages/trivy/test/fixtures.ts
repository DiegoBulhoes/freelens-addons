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

/**
 * Real contents of a cluster running the Trivy operator, exported by
 * `scripts/export-fixtures.sh` and sanitised. They are deliberately the awkward
 * state rather than a tidy one: most workloads have an SBOM and no vulnerability
 * verdict, because the scan job was failing when these were taken. That is the
 * case the extension exists for, so it is the case the tests run against.
 */

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

/** Both kinds together, which is how the page reads them. */
export function allRbacReports() {
  return [...rbacReports(), ...clusterRbacReports()];
}

/**
 * The cluster's own pods, as `PodLike`. Built by hand rather than through
 * KubeObject: the accessors this needs are the three the join uses, and the
 * host's Pod class brings a constructor that rejects half of these for fields
 * nothing here reads.
 */
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

/** Every vulnerability across every report, which is what the finding rules take. */
export function allVulnerabilities() {
  return vulnerabilityReports().flatMap((report) => report.report?.vulnerabilities ?? []);
}

/**
 * The moment these fixtures were taken, so "recently" keeps meaning what it
 * meant then rather than decaying into failure as the file ages.
 */
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
