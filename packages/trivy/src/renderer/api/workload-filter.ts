import { COVERAGE_STATUS } from "./coverage";
import { countOf, totalOf } from "./severity";
import { subjectKey } from "./subjects";
import { STATE_RANK, type WorkloadRow } from "./workload-rows";

export type WorkloadFilter = "all" | "unjudged" | "withFindings";

export const FILTER_LABELS: Record<WorkloadFilter, string> = {
  all: "All",
  unjudged: "No verdict",
  withFindings: "Findings",
};

export const FILTER_TITLES: Record<WorkloadFilter, string> = {
  all: "Shows every workload the operator knows about",
  unjudged: "Shows only the workloads with no vulnerability verdict",
  withFindings: "Shows only the workloads with a critical or high finding",
};

export function isWorkloadFilter(value: unknown): value is WorkloadFilter {
  // `in` would answer true for "toString"; own keys only.
  return typeof value === "string" && Object.hasOwn(FILTER_LABELS, value);
}

export function matchesFilter(row: WorkloadRow, filter: WorkloadFilter): boolean {
  if (filter === "unjudged") return row.state !== "scanned";

  if (filter === "withFindings") {
    return countOf(row.summary, "CRITICAL") + countOf(row.summary, "HIGH") > 0;
  }

  return true;
}

export function selectWorkloads(rows: WorkloadRow[], filter: WorkloadFilter): WorkloadRow[] {
  return rows.filter((row) => matchesFilter(row, filter));
}

export function workloadSearchTexts(row: WorkloadRow): string[] {
  return [
    row.subject.namespace,
    row.subject.kind,
    row.subject.name,
    COVERAGE_STATUS[row.state].label,
  ];
}

export type WorkloadColumn =
  | "Workload"
  | "Kind"
  | "Namespace"
  | "Coverage"
  | "Critical"
  | "High"
  | "Other"
  | "Fix published";

// Counts of an unjudged workload are unknown, not zero, so they sort last either way.
export function workloadSortValue(
  row: WorkloadRow,
  column: WorkloadColumn,
): string | number | undefined {
  switch (column) {
    case "Workload":
      return row.subject.name;
    case "Kind":
      return row.subject.kind;
    case "Namespace":
      return row.subject.namespace;
    case "Coverage":
      return STATE_RANK[row.state];
    default:
      return row.state === "scanned" ? countIn(row, column) : undefined;
  }
}

export function countIn(row: WorkloadRow, column: "Critical" | "High" | "Other" | "Fix published") {
  const critical = countOf(row.summary, "CRITICAL");
  const high = countOf(row.summary, "HIGH");

  if (column === "Critical") return critical;
  if (column === "High") return high;
  if (column === "Other") return totalOf(row.summary) - critical - high;

  return row.fixableCount;
}

// Looked up before the filter: a workload a link names opens even when a filter hides its row.
export function rowOf(rows: WorkloadRow[], key: string | undefined): WorkloadRow | undefined {
  if (!key) return undefined;

  return rows.find((row) => subjectKey(row.subject) === key);
}

export function describeEmpty(total: number, filter: WorkloadFilter): string {
  if (total === 0) {
    return "No workload in the selected namespaces has a report from the Trivy operator.";
  }

  if (filter === "unjudged") return "Every workload here has a vulnerability verdict.";
  if (filter === "withFindings") return "No workload here has a critical or high finding.";

  return "Nothing matches that filter.";
}
