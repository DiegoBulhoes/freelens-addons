import { describe, expect, it } from "vitest";

import { subjectKey } from "../src/renderer/api/subjects";
import { searchRows, sortRows as sortByColumn } from "../src/renderer/api/table";
import {
  countIn,
  describeEmpty,
  FILTER_LABELS,
  FILTER_TITLES,
  isWorkloadFilter,
  matchesFilter,
  rowOf,
  selectWorkloads,
  type WorkloadColumn,
  type WorkloadFilter,
  workloadSearchTexts,
  workloadSortValue,
} from "../src/renderer/api/workload-filter";
import { getWorkloadRows, sortRows, type WorkloadRow } from "../src/renderer/api/workload-rows";
import {
  configAuditReports,
  exposedSecretReports,
  sbomReports,
  vulnerabilityReports,
} from "./fixtures";

function clusterRows(): WorkloadRow[] {
  return sortRows(
    getWorkloadRows({
      vulnerabilityReports: vulnerabilityReports(),
      sbomReports: sbomReports(),
      configAuditReports: configAuditReports(),
      exposedSecretReports: exposedSecretReports(),
    }),
  );
}

const row = (over: Partial<WorkloadRow> & { name: string }): WorkloadRow => ({
  subject: { namespace: over.subject?.namespace ?? "argocd", kind: "ReplicaSet", name: over.name },
  state: over.state ?? "scanned",
  summary: over.summary ?? {},
  fixableCount: 0,
  failedCheckCount: 0,
  secretCount: 0,
});

const search = (rows: WorkloadRow[], query: string) => searchRows(rows, query, workloadSearchTexts);

describe("filtering the workload list", () => {
  it("keeps everything under the all filter", () => {
    const rows = clusterRows();

    expect(rows.length).toBeGreaterThan(1);
    expect(selectWorkloads(rows, "all")).toHaveLength(rows.length);
  });

  it("narrows to the unjudged, and every survivor really is one", () => {
    const unjudged = selectWorkloads(clusterRows(), "unjudged");

    expect(unjudged.length).toBeGreaterThan(0);
    for (const each of unjudged) expect(each.state).not.toBe("scanned");
  });

  it("narrows to what has critical or high findings", () => {
    const withFindings = selectWorkloads(clusterRows(), "withFindings");

    expect(withFindings.length).toBeGreaterThan(0);
    for (const each of withFindings) {
      const worst = (each.summary.criticalCount ?? 0) + (each.summary.highCount ?? 0);

      expect(worst).toBeGreaterThan(0);
    }
  });

  it("finds nothing with findings when every row was judged clean", () => {
    const clean = [row({ name: "web" }), row({ name: "api" })];

    expect(selectWorkloads(clean, "withFindings")).toEqual([]);
  });

  it("answers every filter key without falling through", () => {
    const one = row({ name: "web" });

    for (const key of Object.keys(FILTER_LABELS) as WorkloadFilter[]) {
      expect(typeof matchesFilter(one, key)).toBe("boolean");
    }
  });

  it("rejects a filter key that is not one of ours", () => {
    expect(isWorkloadFilter("unjudged")).toBe(true);
    expect(isWorkloadFilter("a-filter-that-was-renamed")).toBe(false);
    expect(isWorkloadFilter(undefined)).toBe(false);
    expect(isWorkloadFilter("toString")).toBe(false);
  });

  it("counts a workload with highs but no criticals as having findings", () => {
    expect(matchesFilter(row({ name: "web", summary: { highCount: 3 } }), "withFindings")).toBe(
      true,
    );
  });

  it("gives every filter a tooltip saying what it leaves", () => {
    for (const key of Object.keys(FILTER_LABELS) as WorkloadFilter[]) {
      expect(FILTER_TITLES[key]).toMatch(/^Shows /);
    }
  });
});

describe("searching the workload list", () => {
  it("finds a workload the cluster really has by its name", () => {
    const rows = clusterRows();
    const target = rows[0] as WorkloadRow;

    expect(search(rows, target.subject.name).map((each) => subjectKey(each.subject))).toContain(
      subjectKey(target.subject),
    );
  });

  it("searches the namespace too, not only the name", () => {
    const rows = clusterRows();
    const namespace = (rows[0] as WorkloadRow).subject.namespace;
    const found = search(rows, namespace);

    expect(found.length).toBeGreaterThan(0);
    for (const each of found) expect(subjectKey(each.subject)).toContain(namespace);
  });

  it("finds the unjudged by the words their coverage cell shows", () => {
    const rows = clusterRows();
    const found = search(rows, "no verdict");

    expect(found.length).toBeGreaterThan(0);
    for (const each of found) expect(each.state).toBe("read-but-no-verdict");
  });

  it("searches case-insensitively", () => {
    const target = (clusterRows()[0] as WorkloadRow).subject.name;

    expect(search([row({ name: target })], target.toUpperCase())).toHaveLength(1);
  });

  it("returns nothing, rather than everything, for a search that matches no row", () => {
    expect(search(clusterRows(), "no-workload-is-called-this")).toEqual([]);
  });
});

describe("sorting the workload list by a column", () => {
  const byColumn = (rows: WorkloadRow[], column: WorkloadColumn) =>
    sortByColumn(rows, { column, direction: "descending" }, (each, title) =>
      workloadSortValue(each, title as WorkloadColumn),
    );

  it("puts the workload with the most criticals first, and the unjudged last", () => {
    const sorted = byColumn(clusterRows(), "Critical");
    const scanned = sorted.filter((each) => each.state === "scanned");
    const criticals = scanned.map((each) => countIn(each, "Critical"));

    expect(criticals.length).toBeGreaterThan(1);
    expect([...criticals].sort((first, second) => second - first)).toEqual(criticals);
    expect(sorted.slice(0, scanned.length)).toEqual(scanned);
  });

  it("knows no count for a workload nobody judged, rather than zero", () => {
    const unjudged = row({ name: "web", state: "never-looked" });

    for (const column of ["Critical", "High", "Other", "Fix published"] as const) {
      expect(workloadSortValue(unjudged, column)).toBeUndefined();
    }
  });

  it("counts everything below high as other, and the fixable apart", () => {
    const one = {
      ...row({
        name: "web",
        summary: { criticalCount: 1, highCount: 2, mediumCount: 3, lowCount: 4, unknownCount: 5 },
      }),
      fixableCount: 7,
    };

    expect(workloadSortValue(one, "Critical")).toBe(1);
    expect(workloadSortValue(one, "High")).toBe(2);
    expect(workloadSortValue(one, "Other")).toBe(12);
    expect(workloadSortValue(one, "Fix published")).toBe(7);
  });

  it("sorts by the identity columns and by coverage, unjudged first", () => {
    const first = clusterRows()[0] as WorkloadRow;

    expect(workloadSortValue(first, "Workload")).toBe(first.subject.name);
    expect(workloadSortValue(first, "Kind")).toBe(first.subject.kind);
    expect(workloadSortValue(first, "Namespace")).toBe(first.subject.namespace);
    expect(workloadSortValue(row({ name: "a", state: "never-looked" }), "Coverage")).toBeLessThan(
      workloadSortValue(row({ name: "b", state: "scanned" }), "Coverage") as number,
    );
  });
});

describe("opening the workload a link names", () => {
  it("finds the row the route names", () => {
    const rows = clusterRows();
    const named = rows.at(-1) as WorkloadRow;

    expect(rowOf(rows, subjectKey(named.subject))).toBe(named);
  });

  it("opens it even when the filter hides its row", () => {
    const rows = clusterRows();
    const unjudged = rows.find((each) => each.state !== "scanned") as WorkloadRow;

    expect(selectWorkloads(rows, "withFindings")).not.toContain(unjudged);
    expect(rowOf(rows, subjectKey(unjudged.subject))).toBe(unjudged);
  });

  it("opens nothing once the namespace selector leaves it out, or when nothing is named", () => {
    const rows = clusterRows();

    expect(rowOf(rows, "default/ReplicaSet/gone")).toBeUndefined();
    expect(rowOf(rows, undefined)).toBeUndefined();
  });
});

describe("saying why the list is empty", () => {
  it("blames the namespaces selected when nothing in them has a report", () => {
    expect(describeEmpty(0, "unjudged")).toMatch(/selected namespaces/);
  });

  it("says what each filter found none of", () => {
    expect(describeEmpty(3, "unjudged")).toBe("Every workload here has a vulnerability verdict.");
    expect(describeEmpty(3, "withFindings")).toBe(
      "No workload here has a critical or high finding.",
    );
    expect(describeEmpty(3, "all")).toBe("Nothing matches that filter.");
  });
});
