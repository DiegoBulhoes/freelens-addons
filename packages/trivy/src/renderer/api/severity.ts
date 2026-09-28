import type { Severity, SeveritySummary } from "./types";

/** Worst first, which is the order every list here is in. */
const SEVERITY_ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN", "NONE"];

const SUMMARY_FIELDS: Record<Severity, keyof SeveritySummary> = {
  CRITICAL: "criticalCount",
  HIGH: "highCount",
  MEDIUM: "mediumCount",
  LOW: "lowCount",
  UNKNOWN: "unknownCount",
  NONE: "noneCount",
};

export function rankOf(severity: Severity | undefined): number {
  const rank = SEVERITY_ORDER.indexOf(severity as Severity);

  // An unrecognised severity sorts last rather than first: a value this code
  // has never seen is not evidence of an emergency.
  return rank === -1 ? SEVERITY_ORDER.length : rank;
}

export function countOf(summary: SeveritySummary | undefined, severity: Severity): number {
  return summary?.[SUMMARY_FIELDS[severity]] ?? 0;
}

export function totalOf(summary: SeveritySummary | undefined): number {
  return SEVERITY_ORDER.reduce((running, severity) => running + countOf(summary, severity), 0);
}

/** Adds summaries without inventing fields none of them carried. */
export function addSummaries(summaries: (SeveritySummary | undefined)[]): SeveritySummary {
  const total: SeveritySummary = {};

  for (const severity of SEVERITY_ORDER) {
    const field = SUMMARY_FIELDS[severity];
    const sum = summaries.reduce((running, summary) => running + countOf(summary, severity), 0);

    if (sum > 0) total[field] = sum;
  }

  return total;
}
