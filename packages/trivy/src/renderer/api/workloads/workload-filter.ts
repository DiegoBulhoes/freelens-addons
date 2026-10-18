import { countOf, criticalOrHighOf, totalOf } from "../shared/severity";
import { subjectKey } from "../shared/subjects";
import { COVERAGE_STATUS, isUnjudged } from "./coverage";
import { COVERAGE_RANK, type WorkloadRow } from "./workload-rows";

export type WorkloadFilter =
  | "all"
  | "unjudged"
  | "withFindings"
  | "criticalFixable"
  | "criticalUnfixable"
  | "highFixable"
  | "configIssues"
  | "exposedSecrets";

export const FILTER_LABELS: Record<WorkloadFilter, string> = {
  all: "All",
  unjudged: "No verdict",
  withFindings: "Findings",
  criticalFixable: "Critical, fix published",
  criticalUnfixable: "Critical, no fix yet",
  highFixable: "High, fix published",
  configIssues: "Config issues, critical or high",
  exposedSecrets: "Exposed secrets, critical or high",
};

export const FILTER_TITLES: Record<WorkloadFilter, string> = {
  all: "Shows every workload the operator knows about",
  unjudged: "Shows only the workloads with no vulnerability verdict",
  withFindings: "Shows only the workloads with a critical or high finding",
  criticalFixable: "Shows only the workloads with a critical finding that has a published fix",
  criticalUnfixable: "Shows only the workloads with a critical finding that has no published fix",
  highFixable: "Shows only the workloads with a high finding that has a published fix",
  configIssues: "Shows only the workloads with a critical or high failed config check",
  exposedSecrets: "Shows only the workloads with a critical or high exposed secret",
};

const EMPTY_TEXTS: Record<Exclude<WorkloadFilter, "all">, string> = {
  unjudged: "Every workload here has a vulnerability verdict.",
  withFindings: "No workload here has a critical or high finding.",
  criticalFixable: "No critical finding here has a published fix.",
  criticalUnfixable: "Every critical finding here has a published fix.",
  highFixable: "No high finding here has a published fix.",
  configIssues: "No workload here fails a critical or high config check.",
  exposedSecrets: "No workload here exposes a critical or high secret.",
};

export function isWorkloadFilter(value: unknown): value is WorkloadFilter {
  // `in` would answer true for "toString"; own keys only.
  return typeof value === "string" && Object.hasOwn(FILTER_LABELS, value);
}

/** A route's filter param, or All for a missing or renamed one. */
export function filterFromRoute(value: unknown): WorkloadFilter {
  return isWorkloadFilter(value) ? value : "all";
}

export function matchesFilter(row: WorkloadRow, filter: WorkloadFilter): boolean {
  if (filter === "unjudged") return isUnjudged(row.state);

  if (filter === "withFindings") {
    return criticalOrHighOf(row.summary) > 0;
  }

  if (filter === "all") return true;

  return row[filter] > 0;
}

export function selectWorkloads(rows: WorkloadRow[], filter: WorkloadFilter): WorkloadRow[] {
  return rows.filter((row) => matchesFilter(row, filter));
}

export function filterCounts(rows: WorkloadRow[]): Record<WorkloadFilter, number> {
  const counts = {} as Record<WorkloadFilter, number>;

  for (const filter of Object.keys(FILTER_LABELS) as WorkloadFilter[]) {
    counts[filter] = selectWorkloads(rows, filter).length;
  }

  return counts;
}

export function workloadSearchTexts(row: WorkloadRow): string[] {
  const owner = row.deployment;

  return [
    row.subject.namespace,
    row.subject.kind,
    row.subject.name,
    ...(owner ? [owner] : []),
    COVERAGE_STATUS[row.state].label,
  ];
}

export type CountColumn = "Critical" | "High" | "Other" | "Fix published";

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
      return COVERAGE_RANK[row.state];
    default:
      return row.state === "scanned" ? countInColumn(row, column) : undefined;
  }
}

export function countInColumn(row: WorkloadRow, column: CountColumn) {
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

  if (filter === "all") return "Nothing matches that filter.";

  return EMPTY_TEXTS[filter];
}
