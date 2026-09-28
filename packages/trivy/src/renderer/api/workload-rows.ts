import type { CoverageState } from "./coverage";
import { getCoverage } from "./coverage";
import { hasFix } from "./findings";
import { coverageInputOf, type OverviewInput } from "./overview";
import { countOf } from "./severity";
import { subjectKey, subjectOf } from "./subjects";
import type { ReportSubject, SeveritySummary } from "./types";

/**
 * One row per workload the operator knows about, scanned or not.
 *
 * Built in one pass over each report kind rather than by asking per row: the
 * question "what does this workload have" is asked once per rendered line, and
 * answering it by scanning the fleet each time is quadratic in a way that only
 * shows up on someone else's larger cluster.
 */

export interface WorkloadRow {
  subject: ReportSubject;
  state: CoverageState;
  summary: SeveritySummary;
  fixableCount: number;
  failedCheckCount: number;
  secretCount: number;
  /** When the verdict was reached, for judging whether it is still worth anything. */
  scannedAt?: string;
}

export function getWorkloadRows(input: OverviewInput): WorkloadRow[] {
  const vulnerabilityBy = new Map<
    string,
    { summary: SeveritySummary; fixable: number; at?: string }
  >();
  const checksBy = new Map<string, number>();
  const secretsBy = new Map<string, number>();

  for (const report of input.vulnerabilityReports) {
    const subject = subjectOf(report);

    if (!subject) continue;

    const key = subjectKey(subject);
    const existing = vulnerabilityBy.get(key);
    const vulnerabilities = report.report?.vulnerabilities ?? [];
    const fixable = vulnerabilities.filter(hasFix).length;
    const at = report.report?.updateTimestamp;

    if (!existing) {
      vulnerabilityBy.set(key, { summary: report.report?.summary ?? {}, fixable, at });

      continue;
    }

    // A workload with several containers gets one report each; the row is the workload.
    existing.summary = addInto(existing.summary, report.report?.summary);
    existing.fixable += fixable;
    if (at && (!existing.at || at > existing.at)) existing.at = at;
  }

  for (const report of input.configAuditReports) {
    const subject = subjectOf(report);

    if (!subject) continue;

    const failed = (report.report?.checks ?? []).filter((check) => check.success === false).length;

    checksBy.set(subjectKey(subject), (checksBy.get(subjectKey(subject)) ?? 0) + failed);
  }

  for (const report of input.exposedSecretReports) {
    const subject = subjectOf(report);

    if (!subject) continue;

    const count = report.report?.secrets?.length ?? 0;

    secretsBy.set(subjectKey(subject), (secretsBy.get(subjectKey(subject)) ?? 0) + count);
  }

  return getCoverage(coverageInputOf(input)).map((entry) => {
    const key = subjectKey(entry.subject);
    const found = vulnerabilityBy.get(key);

    return {
      subject: entry.subject,
      state: entry.state,
      summary: found?.summary ?? {},
      fixableCount: found?.fixable ?? 0,
      failedCheckCount: checksBy.get(key) ?? 0,
      secretCount: secretsBy.get(key) ?? 0,
      scannedAt: found?.at,
    };
  });
}

function addInto(into: SeveritySummary, more: SeveritySummary | undefined): SeveritySummary {
  return {
    criticalCount: countOf(into, "CRITICAL") + countOf(more, "CRITICAL"),
    highCount: countOf(into, "HIGH") + countOf(more, "HIGH"),
    mediumCount: countOf(into, "MEDIUM") + countOf(more, "MEDIUM"),
    lowCount: countOf(into, "LOW") + countOf(more, "LOW"),
    unknownCount: countOf(into, "UNKNOWN") + countOf(more, "UNKNOWN"),
  };
}

/** Worst first: never looked at, then unjudged, then by severity. */
export function sortRows(rows: WorkloadRow[]): WorkloadRow[] {
  const stateRank = { "never-looked": 0, "read-but-no-verdict": 1, scanned: 2 } as const;

  return [...rows].sort((first, second) => {
    if (first.state !== second.state) return stateRank[first.state] - stateRank[second.state];

    const byCritical = countOf(second.summary, "CRITICAL") - countOf(first.summary, "CRITICAL");

    if (byCritical !== 0) return byCritical;

    const byHigh = countOf(second.summary, "HIGH") - countOf(first.summary, "HIGH");

    if (byHigh !== 0) return byHigh;

    return subjectKey(first.subject).localeCompare(subjectKey(second.subject));
  });
}

/**
 * Where the work is, once the scanner has looked: the scanned workloads with
 * the most critical findings, then the most high, in the picker's own order.
 * One with neither is not listed — "nothing critical or high" is not exposure —
 * and one without a verdict is the coverage section's business, not this one's.
 */
export function mostExposed(rows: WorkloadRow[], limit: number): WorkloadRow[] {
  return sortRows(rows)
    .filter(
      (row) =>
        row.state === "scanned" &&
        countOf(row.summary, "CRITICAL") + countOf(row.summary, "HIGH") > 0,
    )
    .slice(0, limit);
}
