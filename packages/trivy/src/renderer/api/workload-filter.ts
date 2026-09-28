import { countOf } from "./severity";
import { subjectKey } from "./subjects";
import type { WorkloadRow } from "./workload-rows";

/**
 * Which workloads the list shows.
 *
 * In the page this was written inline, which left the one part of the screen
 * nothing could test — and it is the part that decides what an operator sees.
 * A filter that silently matches nothing looks exactly like a cluster with
 * nothing in it.
 */

export type WorkloadFilter = "all" | "unjudged" | "withFindings";

export const FILTER_LABELS: Record<WorkloadFilter, string> = {
  all: "All",
  unjudged: "No verdict",
  withFindings: "Findings",
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

/** Matched against the namespace, the kind and the name, which is what a key holds. */
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
