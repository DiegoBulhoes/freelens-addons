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

/**
 * Everything the overview shows, decided from plain arrays.
 *
 * The one rule the whole page is built around: a count of findings is a count
 * of what was looked at, never of what exists. Every headline here is paired
 * with how much of the cluster it was drawn from.
 */

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
  /** Severity totals across the reports that exist — not across the cluster. */
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

/**
 * Every report kind contributes to the list of known workloads. Taking one kind
 * as the list would drop workloads the others know about: a ReplicaSet scaled
 * away keeps its SBOM after its config audit has been collected.
 */
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

/** The workloads an operator would chase first: unjudged, worst state first. */
export function unjudgedWorkloads(coverage: CoverageEntry[]): CoverageEntry[] {
  return coverage
    .filter((entry) => entry.state !== "scanned")
    .sort((first, second) => {
      if (first.state !== second.state) return first.state === "never-looked" ? -1 : 1;

      return subjectKey(first.subject).localeCompare(subjectKey(second.subject));
    });
}
