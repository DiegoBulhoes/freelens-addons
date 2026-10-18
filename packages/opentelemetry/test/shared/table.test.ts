import { describe, expect, it } from "vitest";

import { type CoverageRow, coverageRows } from "../../src/renderer/api/coverage/coverage";
import { describeCount, nextSort, searchRows, sortRows } from "../../src/renderer/api/shared/table";
import { coverageInventory } from "../support/fixtures";

const rows = () => coverageRows(coverageInventory());
const names = (list: CoverageRow[]) => list.map((row) => row.name);
const valueAt = (row: CoverageRow, column: string) =>
  column === "Pods" ? row.total : column === "Namespace" ? row.namespace : row.name;

describe("searching", () => {
  it("keeps rows whose texts contain every word, ignoring case", () => {
    expect(
      names(searchRows(rows(), "OTEL-LATE restart", (row) => [row.namespace, row.verdict.label])),
    ).toEqual(["late", "late-agent"]);
    expect(searchRows(rows(), " ", (row) => [row.name])).toHaveLength(rows().length);
  });
});

describe("sorting", () => {
  it("orders by a column, keeping the incoming order between equals", () => {
    const sorted = sortRows(rows(), { column: "Namespace", direction: "ascending" }, valueAt);

    expect(sorted.map((row) => row.namespace)).toEqual(
      [...rows().map((row) => row.namespace)].sort(),
    );
    expect(names(sorted.filter((row) => row.namespace === "otel-apps"))).toEqual([
      "typo",
      "misplaced",
      "checkout",
      "ledger",
    ]);
  });

  it("puts empty values last, and orders names as people read numbers", () => {
    expect(
      sortRows(
        [{ v: undefined }, { v: 2 }],
        { column: "x", direction: "ascending" },
        (row) => row.v,
      ),
    ).toEqual([{ v: 2 }, { v: undefined }]);
    expect(
      sortRows(["late-10", "late-2"], { column: "x", direction: "ascending" }, (row) => row),
    ).toEqual(["late-2", "late-10"]);
    expect(
      sortRows([{ v: 1 }, { v: 3 }], { column: "x", direction: "descending" }, (row) => row.v),
    ).toEqual([{ v: 3 }, { v: 1 }]);
    expect(names(sortRows(rows(), undefined, valueAt))).toEqual(names(rows()));
  });

  it("cycles a header and counts what is shown", () => {
    const first = nextSort(undefined, "Pods");

    expect(first).toEqual({ column: "Pods", direction: "ascending" });
    expect(nextSort(nextSort(first, "Pods"), "Pods")).toBeUndefined();
    expect(nextSort(first, "Name")).toEqual({ column: "Name", direction: "ascending" });
    expect(describeCount(2, 5)).toBe("2 of 5 items");
    expect(describeCount(1, 1)).toBe("1 item");
  });
});
