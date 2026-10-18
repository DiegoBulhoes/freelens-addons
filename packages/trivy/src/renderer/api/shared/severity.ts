import type { Severity, SeveritySummary, Tone } from "./types";

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

  // Unknown values sort last: an unseen value is not an emergency.
  return rank === -1 ? SEVERITY_ORDER.length : rank;
}

export function compareSeverity(first: Severity | undefined, second: Severity | undefined): number {
  return rankOf(first) - rankOf(second);
}

export function countOf(summary: SeveritySummary | undefined, severity: Severity): number {
  return summary?.[SUMMARY_FIELDS[severity]] ?? 0;
}

/** What the config and secret cards count, and what their filters list a workload for. */
export function criticalOrHighOf(summary: SeveritySummary | undefined): number {
  return countOf(summary, "CRITICAL") + countOf(summary, "HIGH");
}

export function totalOf(summary: SeveritySummary | undefined): number {
  return SEVERITY_ORDER.reduce((running, severity) => running + countOf(summary, severity), 0);
}

export function addSummaries(summaries: (SeveritySummary | undefined)[]): SeveritySummary {
  const total: SeveritySummary = {};

  for (const severity of SEVERITY_ORDER) {
    const field = SUMMARY_FIELDS[severity];
    const sum = summaries.reduce((running, summary) => running + countOf(summary, severity), 0);

    if (sum > 0) total[field] = sum;
  }

  return total;
}

export function summaryOf(severities: (Severity | undefined)[]): SeveritySummary {
  const summary: SeveritySummary = {};

  for (const severity of severities) {
    const field = SUMMARY_FIELDS[severity ?? "UNKNOWN"];

    summary[field] = (summary[field] ?? 0) + 1;
  }

  return summary;
}

export function toneOf(severity: Severity | undefined): Tone {
  if (severity === "CRITICAL") return "critical";
  if (severity === "HIGH") return "warning";

  return "info";
}
