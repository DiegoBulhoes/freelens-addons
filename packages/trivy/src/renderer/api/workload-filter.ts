import { countOf } from "./severity";
import { subjectKey } from "./subjects";
import type { ReportSubject } from "./types";
import type { WorkloadRow } from "./workload-rows";

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

export function matchesSearch(row: WorkloadRow, searchText: string): boolean {
  const needle = searchText.trim().toLowerCase();

  if (needle === "") return true;

  return subjectKey(row.subject).toLowerCase().includes(needle);
}

export function selectWorkloads(
  rows: WorkloadRow[],
  filter: WorkloadFilter,
  searchText: string,
): WorkloadRow[] {
  return rows.filter((row) => matchesFilter(row, filter) && matchesSearch(row, searchText));
}

// A routed workload out of scope falls back to the first row: its reports would read as none.
export function chooseSelected(
  rows: WorkloadRow[],
  shown: WorkloadRow[],
  fromRoute: ReportSubject | undefined,
): ReportSubject | undefined {
  if (fromRoute) {
    const key = subjectKey(fromRoute);

    if (rows.some((row) => subjectKey(row.subject) === key)) return fromRoute;
  }

  return shown[0]?.subject;
}

export function describeEmpty(total: number, filter: WorkloadFilter, searchText: string): string {
  if (total === 0) {
    return "No workload in the selected namespaces has a report from the Trivy operator.";
  }

  if (searchText.trim() !== "") return "Nothing matches the search.";
  if (filter === "unjudged") return "Every workload here has a vulnerability verdict.";
  if (filter === "withFindings") return "No workload here has a critical or high finding.";

  return "Nothing matches that filter.";
}
