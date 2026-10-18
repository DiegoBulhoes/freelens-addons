import {
  coverageInputOf,
  findingsBySubject,
  type OverviewInput,
  type ReportLike,
} from "../overview/overview";
import { countOf, criticalOrHighOf } from "../shared/severity";
import { subjectKey, subjectOf } from "../shared/subjects";
import type { ReportSubject, SeveritySummary, Vulnerability } from "../shared/types";
import { failedChecks, hasFix, tallyFixable } from "../vulnerabilities/findings";
import type { CoverageState } from "./coverage";
import { getCoverage, ownerDeploymentOf } from "./coverage";
import { type Annotated, rescanIntervalOf } from "./report-ttl";

// Indexed by subject once per count: a lookup per row is quadratic.

export interface WorkloadRow {
  subject: ReportSubject;
  state: CoverageState;
  summary: SeveritySummary;
  fixableCount: number;
  /** The findings each severity card counts, so its filter lists the rows that make it up. */
  criticalFixable: number;
  criticalUnfixable: number;
  highFixable: number;
  failedCheckCount: number;
  secretCount: number;
  /** Critical or high, as the config and secret cards count them. */
  configIssues: number;
  exposedSecrets: number;
  /** The Deployment of a ReplicaSet, from its ownerReferences once it is read. */
  deployment?: string;
  scannedAt?: string;
  /** When the first of its reports outlives its own report-ttl, in epoch ms. */
  overdueAt?: number;
}

interface VulnerabilityFacts {
  summary: SeveritySummary;
  at?: string;
  overdueAt?: number;
}

function vulnerabilityFactsBySubject(
  reports: OverviewInput["vulnerabilityReports"],
): Map<string, VulnerabilityFacts> {
  const factsBy = new Map<string, VulnerabilityFacts>();

  for (const report of reports) {
    const subject = subjectOf(report);

    if (!subject) continue;

    const key = subjectKey(subject);
    const existing = factsBy.get(key);
    const at = report.report?.updateTimestamp;
    const overdueAt = overdueAtOf(report, at);

    if (!existing) {
      factsBy.set(key, {
        summary: report.report?.summary ?? {},
        at,
        overdueAt,
      });

      continue;
    }

    // One report per container; the row is the workload.
    existing.summary = mergeContainerSummaries(existing.summary, report.report?.summary);
    if (at && (!existing.at || at > existing.at)) existing.at = at;
    existing.overdueAt = earliest(existing.overdueAt, overdueAt);
  }

  return factsBy;
}

// Drops noneCount, as the multi-container rows always have; addSummaries would change Other.
function mergeContainerSummaries(
  into: SeveritySummary,
  more: SeveritySummary | undefined,
): SeveritySummary {
  return {
    criticalCount: countOf(into, "CRITICAL") + countOf(more, "CRITICAL"),
    highCount: countOf(into, "HIGH") + countOf(more, "HIGH"),
    mediumCount: countOf(into, "MEDIUM") + countOf(more, "MEDIUM"),
    lowCount: countOf(into, "LOW") + countOf(more, "LOW"),
    unknownCount: countOf(into, "UNKNOWN") + countOf(more, "UNKNOWN"),
  };
}

function countBySubject<Body>(
  reports: ReportLike<Body>[],
  count: (report: ReportLike<Body>) => number,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const report of reports) {
    const subject = subjectOf(report);

    if (!subject) continue;

    const key = subjectKey(subject);

    counts.set(key, (counts.get(key) ?? 0) + count(report));
  }

  return counts;
}

export function getWorkloadRows(input: OverviewInput): WorkloadRow[] {
  const vulnerabilityBy = vulnerabilityFactsBySubject(input.vulnerabilityReports);
  const failedChecksBy = countBySubject(
    input.configAuditReports,
    (report) => failedChecks(report.report?.checks).length,
  );
  const configIssuesBy = countBySubject(input.configAuditReports, (report) =>
    criticalOrHighOf(report.report?.summary),
  );
  const secretsBy = countBySubject(
    input.exposedSecretReports,
    (report) => report.report?.secrets?.length ?? 0,
  );
  const exposedSecretsBy = countBySubject(input.exposedSecretReports, (report) =>
    criticalOrHighOf(report.report?.summary),
  );
  const findingsBy = findingsBySubject(input.vulnerabilityReports);

  const coverageInput = coverageInputOf(input);

  return getCoverage(coverageInput).map((entry) => {
    const key = subjectKey(entry.subject);
    const found = vulnerabilityBy.get(key);
    const findings = findingsBy.get(key) ?? [];

    return {
      subject: entry.subject,
      state: entry.state,
      summary: found?.summary ?? {},
      fixableCount: findings.filter(hasFix).length,
      ...talliesOf(findings),
      failedCheckCount: failedChecksBy.get(key) ?? 0,
      secretCount: secretsBy.get(key) ?? 0,
      configIssues: configIssuesBy.get(key) ?? 0,
      exposedSecrets: exposedSecretsBy.get(key) ?? 0,
      deployment: ownerDeploymentOf(entry.subject, coverageInput.running),
      scannedAt: found?.at,
      overdueAt: found?.overdueAt,
    };
  });
}

type Tallies = Pick<WorkloadRow, "criticalFixable" | "criticalUnfixable" | "highFixable">;

// Counted as the overview's cards are, so a card's number is the sum over its filter's rows.
function talliesOf(vulnerabilities: Vulnerability[]): Tallies {
  const critical = tallyFixable(vulnerabilities, "CRITICAL");

  return {
    criticalFixable: critical.fixable,
    criticalUnfixable: critical.unfixable,
    highFixable: tallyFixable(vulnerabilities, "HIGH").fixable - critical.fixable,
  };
}

function overdueAtOf(report: Annotated, at: string | undefined): number | undefined {
  const parsed = at ? Date.parse(at) : Number.NaN;

  return Number.isNaN(parsed) ? undefined : parsed + rescanIntervalOf(report);
}

function earliest(first: number | undefined, second: number | undefined): number | undefined {
  if (first === undefined) return second;

  return second === undefined ? first : Math.min(first, second);
}

// Unjudged first: what nobody looked at is the bigger unknown.
export const COVERAGE_RANK: Record<CoverageState, number> = {
  "never-looked": 0,
  "read-but-no-verdict": 1,
  scanned: 2,
  inactive: 3,
};

export function sortWorkloads(rows: WorkloadRow[]): WorkloadRow[] {
  return [...rows].sort((first, second) => {
    if (first.state !== second.state)
      return COVERAGE_RANK[first.state] - COVERAGE_RANK[second.state];

    const byCritical = countOf(second.summary, "CRITICAL") - countOf(first.summary, "CRITICAL");

    if (byCritical !== 0) return byCritical;

    const byHigh = countOf(second.summary, "HIGH") - countOf(first.summary, "HIGH");

    if (byHigh !== 0) return byHigh;

    return subjectKey(first.subject).localeCompare(subjectKey(second.subject));
  });
}

// Scanned only: unjudged workloads are the coverage section's.
export function mostExposed(rows: WorkloadRow[], limit: number): WorkloadRow[] {
  return sortWorkloads(rows)
    .filter((row) => row.state === "scanned" && criticalOrHighOf(row.summary) > 0)
    .slice(0, limit);
}
