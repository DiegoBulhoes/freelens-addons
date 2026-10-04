import { describe, expect, it } from "vitest";

import { runningVersion } from "../src/renderer/api/replica-sets";
import { type ReplicaSetRow, replicaSetRows } from "../src/renderer/api/rows";
import { describeCount, nextSort, searchRows, sortRows } from "../src/renderer/api/table";
import { inventory } from "./fixtures";

const rows = () => replicaSetRows(inventory());
const names = (list: ReplicaSetRow[]) => list.map((row) => row.rs.getName());
const valueAt = (row: ReplicaSetRow, column: string) =>
  column === "Version"
    ? runningVersion(row.rs)
    : column === "Namespace"
      ? row.rs.getNs()
      : row.rs.getName();
const texts = (row: ReplicaSetRow) => [row.rs.getName(), row.health.label];

describe("searching the clusters", () => {
  it("keeps rows whose texts contain every word, ignoring case", () => {
    expect(names(searchRows(rows(), "CATALOG healthy", texts))).toEqual(["catalog-rs"]);
  });

  it("returns every row for an empty query", () => {
    expect(searchRows(rows(), "  ", texts)).toHaveLength(rows().length);
  });
});

describe("sorting the clusters", () => {
  it("orders by a column, keeping the incoming order between equals", () => {
    const before = names(rows());
    const byNamespace = names(
      sortRows(rows(), { column: "Namespace", direction: "descending" }, valueAt),
    );

    expect(byNamespace).toEqual(before);
  });

  it("puts sets with no version last in both directions, in their incoming order", () => {
    const up = names(sortRows(rows(), { column: "Version", direction: "ascending" }, valueAt));
    const down = names(sortRows(rows(), { column: "Version", direction: "descending" }, valueAt));
    const unversioned = names(rows()).filter((name) =>
      ["legacy-rs", "reporting-rs", "upgrade-rs"].includes(name),
    );

    // catalog-rs and secure-rs run the same version: they keep their incoming order either way.
    expect(up.slice(0, 3)).toEqual(["sessions-rs", "catalog-rs", "secure-rs"]);
    expect(down.slice(0, 3)).toEqual(["catalog-rs", "secure-rs", "sessions-rs"]);
    expect(up.slice(3)).toEqual(unversioned);
    expect(down.slice(3)).toEqual(unversioned);
  });

  it("orders names as people read numbers in them", () => {
    const sorted = sortRows(
      ["rs-10", "rs-2"],
      { column: "x", direction: "ascending" },
      (row) => row,
    );

    expect(sorted).toEqual(["rs-2", "rs-10"]);
  });

  it("keeps the incoming order without a sort", () => {
    expect(names(sortRows(rows(), undefined, valueAt))).toEqual(names(rows()));
  });

  it("cycles a header through ascending, descending and none", () => {
    const first = nextSort(undefined, "Version");
    const second = nextSort(first, "Version");

    expect(first).toEqual({ column: "Version", direction: "ascending" });
    expect(second).toEqual({ column: "Version", direction: "descending" });
    expect(nextSort(second, "Version")).toBeUndefined();
    expect(nextSort(second, "Members")).toEqual({ column: "Members", direction: "ascending" });
  });

  it("says how many, and how many of how many while narrowed", () => {
    expect(describeCount(5, 5)).toBe("5 items");
    expect(describeCount(1, 1)).toBe("1 item");
    expect(describeCount(2, 5)).toBe("2 of 5 items");
  });
});
