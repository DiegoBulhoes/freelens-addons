import { describe, expect, it } from "vitest";
import { backupsNewestFirst } from "../../src/renderer/api/backups/backups";
import { clusterRows } from "../../src/renderer/api/overview/attention";
import {
  describeCount,
  limitRows,
  nextSort,
  searchRows,
  sortRows,
} from "../../src/renderer/api/shared/table";
import { backups, fixtureNow, inventory } from "../support/fixtures";

const rows = clusterRows(inventory(), fixtureNow());
const textsOf = (row: (typeof rows)[number]) => [
  row.cluster.getName(),
  row.health.label,
  row.backup.label,
];
const valueAt = (row: (typeof rows)[number], column: string) =>
  column === "Instances" ? row.cluster.status?.readyInstances : row.cluster.getName();

describe("searching the clusters", () => {
  it("keeps rows whose texts contain every word, ignoring case", () => {
    expect(
      searchRows(rows, "NO backup", textsOf)
        .map((row) => row.cluster.getName())
        .sort(),
    ).toEqual(["analytics-db", "audit-db", "inventory-db", "reports-db"]);
    expect(searchRows(rows, "orders backed", textsOf)).toHaveLength(1);
  });

  it("returns every row for an empty query", () => {
    expect(searchRows(rows, "  ", textsOf)).toHaveLength(rows.length);
  });
});

describe("sorting the clusters", () => {
  it("orders names as people read them, both ways", () => {
    const names = (direction: "ascending" | "descending") =>
      sortRows(rows, { column: "Cluster", direction }, valueAt).map((row) => row.cluster.getName());

    expect(names("ascending")).toEqual([
      "analytics-db",
      "audit-db",
      "billing-db",
      "inventory-db",
      "orders-db",
      "orders-replica-db",
      "reports-db",
    ]);
    expect(names("descending")[0]).toBe("reports-db");
  });

  it("puts clusters with no ready count last, and keeps ties in their order", () => {
    for (const direction of ["ascending", "descending"] as const) {
      const sorted = sortRows(rows, { column: "Instances", direction }, valueAt);
      const unknown = sorted.filter((row) => row.cluster.status?.readyInstances === undefined);

      expect(sorted.slice(-unknown.length)).toEqual(
        rows.filter((row) => row.cluster.status?.readyInstances === undefined),
      );
    }

    const ones = sortRows(rows, { column: "Instances", direction: "ascending" }, valueAt).filter(
      (row) => row.cluster.status?.readyInstances === 1,
    );

    expect(ones).toEqual(rows.filter((row) => row.cluster.status?.readyInstances === 1));
  });

  it("keeps the incoming order without a sort", () => {
    expect(sortRows(rows, undefined, valueAt)).toBe(rows);
  });

  it("cycles a header through ascending, descending and none", () => {
    const first = nextSort(undefined, "Cluster");
    const second = nextSort(first, "Cluster");

    expect(first?.direction).toBe("ascending");
    expect(second?.direction).toBe("descending");
    expect(nextSort(second, "Cluster")).toBeUndefined();
    expect(nextSort(second, "Instances")).toEqual({ column: "Instances", direction: "ascending" });
  });
});

describe("counting the clusters", () => {
  it("says how many, and how many of how many while narrowed", () => {
    expect(describeCount(1, 1)).toBe("1 item");
    expect(describeCount(rows.length, rows.length)).toBe(`${rows.length} items`);
    expect(describeCount(2, rows.length)).toBe(`2 of ${rows.length} items`);
  });
});

describe("a long list of backups", () => {
  const all = backupsNewestFirst(backups());
  const names = (list: typeof all) => list.map((backup) => backup.getName());

  it("draws only the first rows of the sorted set, and says how many it left out", () => {
    const { drawn, note } = limitRows(all, 3);

    expect(all.length).toBeGreaterThan(3);
    expect(names(drawn)).toEqual(names(all).slice(0, 3));
    expect(note).toBe(`Showing 3 of ${all.length}. Search, sort or filter to reach the others.`);
  });

  it("draws every row, with no note, when they fit or no cap is set", () => {
    expect(limitRows(all, all.length)).toEqual({ drawn: all });
    expect(limitRows(all, undefined)).toEqual({ drawn: all });
  });
});
