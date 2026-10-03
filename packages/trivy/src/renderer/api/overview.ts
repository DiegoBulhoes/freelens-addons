import { type CoverageEntry, type CoverageInput, getCoverage, tally } from "./coverage";
import { tallyFixable } from "./findings";
import { addSummaries, countOf } from "./severity";
import { type SubjectBearing, subjectKey, subjectOf } from "./subjects";
import type {
  ConfigAuditReportBody,
  ExposedSecretReportBody,
  ReportSubject,
  SeveritySummary,
  VulnerabilityReportBody,
} from "./types";

export interface ReportLike<Body> extends SubjectBearing {
  report?: Body;
}

export interface OverviewInput {
  vulnerabilityReports: ReportLike<VulnerabilityReportBody>[];
  sbomReports: SubjectBearing[];
  configAuditReports: ReportLike<ConfigAuditReportBody>[];
  exposedSecretReports: ReportLike<ExposedSecretReportBody>[];
}

export interface Overview {
  coverage: CoverageEntry[];
  counts: ReturnType<typeof tally>;
  vulnerabilitySummary: SeveritySummary;
  configAuditSummary: SeveritySummary;
  criticalFixable: number;
  criticalUnfixable: number;
  highFixable: number;
  exposedSecrets: number;
}

function subjectsOf(reports: SubjectBearing[]): ReportSubject[] {
  return reports.map(subjectOf).filter((subject) => subject !== undefined);
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
  };
}

export function getOverview(input: OverviewInput): Overview {
  const coverage = getCoverage(coverageInputOf(input));
  const vulnerabilities = input.vulnerabilityReports.flatMap(
    (report) => report.report?.vulnerabilities ?? [],
  );
  const critical = tallyFixable(vulnerabilities, "CRITICAL");
  const high = tallyFixable(vulnerabilities, "HIGH");

  return {
    coverage,
    counts: tally(coverage),
    vulnerabilitySummary: addSummaries(input.vulnerabilityReports.map((r) => r.report?.summary)),
    configAuditSummary: addSummaries(input.configAuditReports.map((r) => r.report?.summary)),
    criticalFixable: critical.fixable,
    criticalUnfixable: critical.unfixable,
    // tallyFixable counts at or above the floor, so HIGH's fixable includes CRITICAL's.
    highFixable: high.fixable - critical.fixable,
    exposedSecrets: input.exposedSecretReports.reduce(
      (running, report) =>
        running +
        countOf(report.report?.summary, "CRITICAL") +
        countOf(report.report?.summary, "HIGH"),
      0,
    ),
  };
}

export function unjudgedWorkloads(coverage: CoverageEntry[]): CoverageEntry[] {
  return coverage
    .filter((entry) => entry.state !== "scanned")
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
