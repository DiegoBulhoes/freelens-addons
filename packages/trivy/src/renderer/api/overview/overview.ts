import { addSummaries, countOf, criticalOrHighOf } from "../shared/severity";
import { type Reporting, type SubjectBearing, subjectKey, subjectOf } from "../shared/subjects";
import type {
  ConfigAuditReportBody,
  ExposedSecretReportBody,
  ReportSubject,
  SeveritySummary,
  Vulnerability,
  VulnerabilityReportBody,
} from "../shared/types";
import { deduplicate, tallyFixable } from "../vulnerabilities/findings";
import {
  bearsAnImage,
  type CoverageEntry,
  type CoverageInput,
  type CoverageTally,
  getCoverage,
  isUnjudged,
  type ReplicaSetLike,
  runningOf,
  tallyCoverage,
} from "../workloads/coverage";
import type { Annotated } from "../workloads/report-ttl";
import type { PodLike } from "../workloads/workload-pods";

export type ReportLike<Body> = Reporting<Body> & Annotated;

export interface OverviewInput {
  vulnerabilityReports: ReportLike<VulnerabilityReportBody>[];
  sbomReports: SubjectBearing[];
  configAuditReports: ReportLike<ConfigAuditReportBody>[];
  exposedSecretReports: ReportLike<ExposedSecretReportBody>[];
  /** Without them no ReplicaSet is judged inactive. */
  pods?: PodLike[];
  podsUnreadIn?: ReadonlySet<string>;
  replicaSets?: ReplicaSetLike[];
  replicaSetsUnreadIn?: ReadonlySet<string>;
}

export interface Overview {
  coverage: CoverageEntry[];
  counts: CoverageTally;
  vulnerabilitySummary: SeveritySummary;
  configAuditSummary: SeveritySummary;
  criticalFixable: number;
  criticalUnfixable: number;
  highFixable: number;
  /** Critical or high failed checks of workloads, as the config card's filter lists them. */
  configIssues: number;
  exposedSecrets: number;
}

function subjectsOf(reports: SubjectBearing[]): ReportSubject[] {
  return reports.map(subjectOf).filter((subject) => subject !== undefined);
}

// Only what the Workloads list has a row for: a Service's checks would count with no row to open.
function workloadCriticalOrHigh(reports: ReportLike<{ summary?: SeveritySummary }>[]): number {
  return reports.reduce((running, report) => {
    const subject = subjectOf(report);

    return subject && bearsAnImage(subject)
      ? running + criticalOrHighOf(report.report?.summary)
      : running;
  }, 0);
}

function keysOf(reports: SubjectBearing[]): Set<string> {
  return new Set(subjectsOf(reports).map(subjectKey));
}

// Every kind counts: a scaled-away ReplicaSet keeps its SBOM after its config audit is gone.
export function coverageInputOf(input: OverviewInput): CoverageInput {
  return {
    known: [
      ...subjectsOf(input.configAuditReports),
      ...subjectsOf(input.sbomReports),
      ...subjectsOf(input.vulnerabilityReports),
      ...subjectsOf(input.exposedSecretReports),
    ],
    withSbom: keysOf(input.sbomReports),
    withVerdict: keysOf(input.vulnerabilityReports),
    running:
      input.pods &&
      runningOf(input.pods, input.podsUnreadIn, input.replicaSets, input.replicaSetsUnreadIn),
  };
}

// Once each across a workload's containers, as its drawer lists them: the operator repeats some.
export function findingsBySubject(
  reports: ReportLike<VulnerabilityReportBody>[],
): Map<string, Vulnerability[]> {
  const gathered = new Map<string, Vulnerability[]>();

  for (const report of reports) {
    const subject = subjectOf(report);

    if (!subject) continue;

    const key = subjectKey(subject);

    const found = gathered.get(key) ?? [];

    found.push(...(report.report?.vulnerabilities ?? []));
    gathered.set(key, found);
  }

  return new Map([...gathered].map(([key, found]) => [key, deduplicate(found)]));
}

export function getOverview(input: OverviewInput): Overview {
  const coverage = getCoverage(coverageInputOf(input));
  const vulnerabilities = [...findingsBySubject(input.vulnerabilityReports).values()].flat();
  const critical = tallyFixable(vulnerabilities, "CRITICAL");
  const high = tallyFixable(vulnerabilities, "HIGH");

  return {
    coverage,
    counts: tallyCoverage(coverage),
    vulnerabilitySummary: addSummaries(input.vulnerabilityReports.map((r) => r.report?.summary)),
    configAuditSummary: addSummaries(input.configAuditReports.map((r) => r.report?.summary)),
    criticalFixable: critical.fixable,
    criticalUnfixable: critical.unfixable,
    // tallyFixable counts at or above the floor, so HIGH's fixable includes CRITICAL's.
    highFixable: high.fixable - critical.fixable,
    configIssues: workloadCriticalOrHigh(input.configAuditReports),
    exposedSecrets: workloadCriticalOrHigh(input.exposedSecretReports),
  };
}

export function unjudgedWorkloads(coverage: CoverageEntry[]): CoverageEntry[] {
  return coverage
    .filter((entry) => isUnjudged(entry.state))
    .sort((first, second) => {
      if (first.state !== second.state) return first.state === "never-looked" ? -1 : 1;

      return subjectKey(first.subject).localeCompare(subjectKey(second.subject));
    });
}

export function describeOverview(overview: Overview): {
  headline: string;
  subline: string;
  alarm: boolean;
} {
  if (overview.counts.total === 0) {
    return {
      headline: "No workload in the selected namespaces has a Trivy report",
      subline:
        "The Trivy operator writes a report for each workload it scans. Select more namespaces, or check that the operator is running.",
      alarm: false,
    };
  }

  const criticals = countOf(overview.vulnerabilitySummary, "CRITICAL");
  const scanned = overview.counts.scanned;
  const unjudged = overview.counts.readButNoVerdict + overview.counts.neverLooked;

  return {
    headline: `${criticals} critical ${criticals === 1 ? "finding" : "findings"} in ${scanned} scanned ${scanned === 1 ? "workload" : "workloads"}`,
    subline:
      unjudged > 0
        ? "These counts are a minimum: the workloads listed below have no verdict yet."
        : "Every workload the operator knows about has a verdict.",
    alarm: unjudged > 0,
  };
}
