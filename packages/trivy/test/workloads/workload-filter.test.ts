import { describe, expect, it } from "vitest";

import { getOverview } from "../../src/renderer/api/overview/overview";
import { subjectKey } from "../../src/renderer/api/shared/subjects";
import { searchRows, sortRows as sortByColumn } from "../../src/renderer/api/shared/table";
import {
  countInColumn,
  describeEmpty,
  FILTER_LABELS,
  FILTER_TITLES,
  filterCounts,
  filterFromRoute,
  isWorkloadFilter,
  matchesFilter,
  rowOf,
  selectWorkloads,
  type WorkloadColumn,
  type WorkloadFilter,
  workloadSearchTexts,
  workloadSortValue,
} from "../../src/renderer/api/workloads/workload-filter";
import {
  getWorkloadRows,
  sortWorkloads,
  type WorkloadRow,
} from "../../src/renderer/api/workloads/workload-rows";
import {
  configAuditReports,
  exposedSecretReports,
  pods,
  sbomReports,
  vulnerabilityReports,
} from "../support/fixtures";

function clusterRows(): WorkloadRow[] {
  return sortWorkloads(
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
  criticalFixable: 0,
  criticalUnfixable: 0,
  highFixable: 0,
  failedCheckCount: 0,
  secretCount: 0,
  configIssues: 0,
  exposedSecrets: 0,
});

const search = (rows: WorkloadRow[], query: string) => searchRows(rows, query, workloadSearchTexts);

describe("counting what each filter chip shows", () => {
  it("counts on each chip exactly the rows that chip shows", () => {
    const rows = clusterRows();
    const counts = filterCounts(rows);

    expect(Object.keys(counts).sort()).toEqual(Object.keys(FILTER_LABELS).sort());
    for (const filter of Object.keys(FILTER_LABELS) as WorkloadFilter[]) {
      expect(counts[filter], filter).toBe(selectWorkloads(rows, filter).length);
    }
  });

  it("gives the narrower chips smaller counts than All on the exported cluster", () => {
    const counts = filterCounts(clusterRows());

    expect(counts.all).toBe(clusterRows().length);
    expect(counts.unjudged).toBeGreaterThan(0);
    expect(counts.unjudged).toBeLessThan(counts.all);
    expect(counts.withFindings).toBeLessThan(counts.all);
  });
});

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

describe("the filters the severity cards open", () => {
  const input = () => ({
    vulnerabilityReports: vulnerabilityReports(),
    sbomReports: sbomReports(),
    configAuditReports: configAuditReports(),
    exposedSecretReports: exposedSecretReports(),
  });
  const cards = ["criticalFixable", "criticalUnfixable", "highFixable"] as const;

  it("lists the workloads whose findings add up to each card's count", () => {
    const overview = getOverview(input());
    const rows = getWorkloadRows(input());

    for (const card of cards) {
      const listed = selectWorkloads(rows, card);
      const counted = listed.reduce((sum, each) => sum + each[card], 0);

      expect(overview[card]).toBeGreaterThan(0);
      expect(counted).toBe(overview[card]);
    }
  });

  it("lists fewer workloads for each card than the findings filter does", () => {
    const rows = getWorkloadRows(input());
    const withFindings = selectWorkloads(rows, "withFindings").length;

    for (const card of cards) {
      const listed = selectWorkloads(rows, card);

      expect(listed.length).toBeGreaterThan(0);
      expect(listed.length).toBeLessThan(withFindings);
      for (const each of rows) expect(listed.includes(each)).toBe(each[card] > 0);
    }
  });

  it("counts a container's criticals in the critical cards only, never again as high", () => {
    const rows = getWorkloadRows(input());
    const web = rows.find((each) => each.subject.name === "web-5774f6f6c7");

    expect(web?.criticalFixable).toBeGreaterThan(0);
    expect((web?.criticalFixable ?? 0) + (web?.criticalUnfixable ?? 0)).toBe(
      web?.summary.criticalCount,
    );
  });

  it("opens from a link that names the filter", () => {
    for (const card of cards) expect(isWorkloadFilter(card)).toBe(true);
  });

  it("says why a card's list is empty in the card's own terms", () => {
    expect(describeEmpty(3, "criticalFixable")).toBe(
      "No critical finding here has a published fix.",
    );
    expect(describeEmpty(3, "criticalUnfixable")).toBe(
      "Every critical finding here has a published fix.",
    );
    expect(describeEmpty(3, "highFixable")).toBe("No high finding here has a published fix.");
  });
});

describe("the filters the config and secret cards open", () => {
  const input = () => ({
    vulnerabilityReports: vulnerabilityReports(),
    sbomReports: sbomReports(),
    configAuditReports: configAuditReports(),
    exposedSecretReports: exposedSecretReports(),
  });

  const listedFor = (
    card: "configIssues" | "exposedSecrets",
    reports: ReturnType<typeof input>,
  ) => {
    const overview = getOverview(reports);
    const rows = getWorkloadRows(reports);
    const listed = selectWorkloads(rows, card);

    return { overview, rows, listed, counted: listed.reduce((sum, each) => sum + each[card], 0) };
  };

  it("lists the workloads whose failed config checks add up to the config card", () => {
    const { overview, rows, listed, counted } = listedFor("configIssues", input());

    expect(overview.configIssues).toBeGreaterThan(0);
    expect(counted).toBe(overview.configIssues);
    for (const each of rows) expect(listed.includes(each)).toBe(each.configIssues > 0);
  });

  it("counts on the config card no check of an object the list has no row for", () => {
    const reports = input();
    const before = getOverview(reports).configIssues;
    const service = reports.configAuditReports.find(
      (report) => report.getName() === "service-pebble",
    );

    if (!service?.report) throw new Error("the pebble Service's audit is gone");
    service.report.summary = { ...service.report.summary, highCount: 4 };

    const { overview, counted } = listedFor("configIssues", reports);

    expect(overview.configIssues).toBe(before);
    expect(counted).toBe(overview.configIssues);
  });

  it("lists the workloads whose critical or high secrets add up to the secrets card", () => {
    const reports = input();
    const [first, second] = reports.exposedSecretReports;

    if (!first?.report || !second?.report) throw new Error("the secret fixtures are gone");
    first.report.summary = { criticalCount: 1, highCount: 2, lowCount: 4 };
    second.report.summary = { highCount: 5, mediumCount: 6 };

    const { overview, rows, listed, counted } = listedFor("exposedSecrets", reports);

    expect(overview.exposedSecrets).toBe(1 + 2 + 5);
    expect(counted).toBe(overview.exposedSecrets);
    expect(listed).toHaveLength(2);
    for (const each of rows) expect(listed.includes(each)).toBe(each.exposedSecrets > 0);
  });

  it("lists no workload for secrets on this cluster, whose secret reports found none", () => {
    expect(listedFor("exposedSecrets", input()).listed).toEqual([]);
  });

  it("says why each list is empty in the card's own terms", () => {
    expect(describeEmpty(3, "configIssues")).toBe(
      "No workload here fails a critical or high config check.",
    );
    expect(describeEmpty(3, "exposedSecrets")).toBe(
      "No workload here exposes a critical or high secret.",
    );
  });
});

describe("reading the filter a link names", () => {
  it("opens on the filter the route names", () => {
    expect(filterFromRoute("configIssues")).toBe("configIssues");
    expect(filterFromRoute("exposedSecrets")).toBe("exposedSecrets");
  });

  it("opens on All for a missing or renamed filter", () => {
    expect(filterFromRoute("")).toBe("all");
    expect(filterFromRoute(undefined)).toBe("all");
    expect(filterFromRoute("a-filter-that-was-renamed")).toBe("all");
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
    const criticals = scanned.map((each) => countInColumn(each, "Critical"));

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

describe("listing scaled-away ReplicaSets", () => {
  const withPods = () =>
    sortWorkloads(
      getWorkloadRows({
        vulnerabilityReports: vulnerabilityReports(),
        sbomReports: sbomReports(),
        configAuditReports: configAuditReports(),
        exposedSecretReports: exposedSecretReports(),
        pods: pods(),
      }),
    );

  it("keeps them out of the No verdict filter and lists them last", () => {
    const rows = withPods();
    const inactive = rows.filter((each) => each.state === "inactive");

    expect(inactive.map((each) => each.subject.name)).toContain("web-794cc4c7f4");
    expect(selectWorkloads(rows, "unjudged").some((each) => each.state === "inactive")).toBe(false);
    expect(rows.at(-1)?.state).toBe("inactive");
  });

  it("finds a ReplicaSet by the Deployment it belongs to", () => {
    const found = search(withPods(), "web").map((each) => each.subject.name);

    expect(found).toEqual(expect.arrayContaining(["web-794cc4c7f4", "web-5774f6f6c7"]));
    const old = withPods().find((each) => each.subject.name === "web-794cc4c7f4");

    expect(old && workloadSearchTexts(old)).toContain("web");
  });
});
