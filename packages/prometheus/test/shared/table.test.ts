import { describe, expect, it } from "vitest";

import { type MonitorRow, monitorRows } from "../../src/renderer/api/monitors/monitors";
import {
  describeCount,
  limitRows,
  nextSort,
  searchRows,
  sortRows,
} from "../../src/renderer/api/shared/table";
import { monitorInventory } from "../support/fixtures";

const rows = () => monitorRows(monitorInventory());
const names = (list: MonitorRow[]) => list.map((row) => row.name);
const valueAt = (row: MonitorRow, column: string) =>
  column === "Namespace" ? row.namespace : column === "Up" ? row.health?.up : row.name;

describe("searching", () => {
  it("keeps rows whose texts contain every word, ignoring case", () => {
    expect(
      names(searchRows(rows(), "PROM-APPS port", (row) => [row.namespace, row.verdict.label])),
    ).toEqual(["wrong-port"]);
    expect(searchRows(rows(), " ", (row) => [row.name])).toHaveLength(rows().length);
  });
});

describe("sorting", () => {
  it("orders by a column, keeping the incoming order between equals", () => {
    const sorted = sortRows(rows(), { column: "Namespace", direction: "ascending" }, valueAt);

    expect(names(sorted.filter((row) => row.namespace === "prom-apps"))).toEqual([
      "no-endpoints",
      "no-service",
      "orphan",
      "otel-self",
      "wrong-port",
      "prom-pods",
      "static-self",
    ]);
  });

  it("puts rows without a value last in either direction", () => {
    const up = sortRows(rows(), { column: "Up", direction: "descending" }, valueAt);

    expect(names(up).slice(0, 1)).toEqual(["kubelet"]);
    expect(up.at(-1)?.health).toBeUndefined();
    expect(names(sortRows(rows(), undefined, valueAt))).toEqual(names(rows()));
  });

  it("cycles a header and counts what is shown", () => {
    const first = nextSort(undefined, "Name");

    expect(first).toEqual({ column: "Name", direction: "ascending" });
    expect(nextSort(nextSort(first, "Name"), "Name")).toBeUndefined();
    expect(nextSort(first, "Namespace")).toEqual({ column: "Namespace", direction: "ascending" });
    expect(describeCount(2, 5)).toBe("2 of 5 items");
    expect(describeCount(1, 1)).toBe("1 item");
  });
});

describe("a long list", () => {
  it("draws only the first rows of the sorted set, and says how many it left out", () => {
    const sorted = sortRows(rows(), { column: "Name", direction: "descending" }, valueAt);
    const { drawn, note } = limitRows(sorted, 3);

    expect(names(drawn)).toEqual(names(sorted).slice(0, 3));
    expect(note).toBe(`Showing 3 of ${sorted.length}. Search, sort or filter to reach the others.`);
    expect(limitRows(sorted, sorted.length)).toEqual({ drawn: sorted });
    expect(limitRows(sorted, undefined)).toEqual({ drawn: sorted });
  });
});
