import { describe, expect, it } from "vitest";

import { subjectKey } from "../src/renderer/api/subjects";
import {
  FILTER_LABELS,
  isWorkloadFilter,
  matchesFilter,
  matchesSearch,
  selectWorkloads,
  type WorkloadFilter,
} from "../src/renderer/api/workload-filter";
import { getWorkloadRows, sortRows, type WorkloadRow } from "../src/renderer/api/workload-rows";
import {
  configAuditReports,
  exposedSecretReports,
  sbomReports,
  vulnerabilityReports,
} from "./fixtures";

/**
 * What an operator is shown. A filter that silently matches nothing looks
 * exactly like a cluster with nothing in it, so every case here asserts what
 * survived as well as what did not.
 */

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

describe("filtering the workload list", () => {
  it("keeps everything under the all filter", () => {
    const rows = clusterRows();

    expect(rows.length).toBeGreaterThan(1);
    expect(selectWorkloads(rows, "all", "")).toHaveLength(rows.length);
  });

  it("narrows to the unjudged, and every survivor really is one", () => {
    const unjudged = selectWorkloads(clusterRows(), "unjudged", "");

    expect(unjudged.length).toBeGreaterThan(0);
    for (const each of unjudged) expect(each.state).not.toBe("scanned");
  });

  it("narrows to what has critical or high findings", () => {
    const withFindings = selectWorkloads(clusterRows(), "withFindings", "");

    expect(withFindings.length).toBeGreaterThan(0);
    for (const each of withFindings) {
      const worst = (each.summary.criticalCount ?? 0) + (each.summary.highCount ?? 0);

      expect(worst).toBeGreaterThan(0);
    }
  });

  it("searches the name, and finds a workload the cluster really has", () => {
    const rows = clusterRows();
    const target = rows[0] as WorkloadRow;

    const found = selectWorkloads(rows, "all", target.subject.name);

    expect(found.map((each) => subjectKey(each.subject))).toContain(subjectKey(target.subject));
  });

  it("searches the namespace too, not only the name", () => {
    const rows = clusterRows();
    const namespace = (rows[0] as WorkloadRow).subject.namespace;

    const found = selectWorkloads(rows, "all", namespace);

    expect(found.length).toBeGreaterThan(0);
    for (const each of found) expect(subjectKey(each.subject)).toContain(namespace);
  });

  it("applies the filter and the search together rather than one of the two", () => {
    const rows = [
      row({ name: "web", state: "scanned", summary: { criticalCount: 1 } }),
      row({ name: "web-two", state: "never-looked" }),
    ];

    // The search matches both; the filter has to still exclude one.
    expect(selectWorkloads(rows, "unjudged", "web").map((each) => each.subject.name)).toEqual([
      "web-two",
    ]);
  });
});

describe("filtering when nothing matches", () => {
  it("returns nothing, rather than everything, for a search that matches no row", () => {
    expect(selectWorkloads(clusterRows(), "all", "no-workload-is-called-this")).toEqual([]);
  });

  it("returns nothing from an empty list without throwing", () => {
    expect(selectWorkloads([], "withFindings", "anything")).toEqual([]);
  });

  it("finds nothing with findings when every row was judged clean", () => {
    const clean = [row({ name: "web" }), row({ name: "api" })];

    expect(selectWorkloads(clean, "withFindings", "")).toEqual([]);
  });
});

describe("filtering on input nobody expects", () => {
  it("treats whitespace as no search at all", () => {
    const rows = clusterRows();

    expect(selectWorkloads(rows, "all", "   ")).toHaveLength(rows.length);
  });

  it("searches case-insensitively, in both directions", () => {
    const target = (clusterRows()[0] as WorkloadRow).subject.name;

    expect(matchesSearch(row({ name: target }), target.toUpperCase())).toBe(true);
    expect(matchesSearch(row({ name: target.toUpperCase() }), target.toLowerCase())).toBe(true);
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
    // A key of Object.prototype is not a filter, however `in` behaves.
    expect(isWorkloadFilter("toString")).toBe(false);
  });

  it("counts a workload with highs but no criticals as having findings", () => {
    expect(matchesFilter(row({ name: "web", summary: { highCount: 3 } }), "withFindings")).toBe(
      true,
    );
  });
});
