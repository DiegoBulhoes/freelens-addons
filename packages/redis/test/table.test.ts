import { describe, expect, it } from "vitest";

import { readyCount } from "../src/renderer/api/nodes";
import { type RedisRow, redisRows } from "../src/renderer/api/rows";
import { describeCount, nextSort, searchRows, sortRows } from "../src/renderer/api/table";
import { inventory } from "./fixtures";

const rows = () => redisRows(inventory());
const names = (list: RedisRow[]) => list.map((row) => row.object.getName());
const valueAt = (row: RedisRow, column: string) =>
  column === "Pods"
    ? readyCount(row.object, row.nodes).ready
    : column === "Namespace"
      ? row.object.getNs()
      : row.object.getName();

describe("searching", () => {
  it("keeps rows whose texts contain every word, ignoring case", () => {
    expect(
      names(searchRows(rows(), "CACHE healthy", (row) => [row.object.getName(), row.health.label])),
    ).toEqual(["cache", "cache-sentinel"]);
    expect(searchRows(rows(), " ", (row) => [row.object.getName()])).toHaveLength(rows().length);
  });
});

describe("sorting", () => {
  it("orders by a column, keeping the incoming order between equals", () => {
    expect(
      names(sortRows(rows(), { column: "Namespace", direction: "descending" }, valueAt)),
    ).toEqual(names(rows()));
  });

  it("orders numbers both ways", () => {
    const up = sortRows(rows(), { column: "Pods", direction: "ascending" }, valueAt);
    const down = sortRows(rows(), { column: "Pods", direction: "descending" }, valueAt);

    expect(names(up)[0]).toBe("broken-cache");
    expect(names(down)[0]).toBe("shards");
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
      sortRows(["rs-10", "rs-2"], { column: "x", direction: "ascending" }, (row) => row),
    ).toEqual(["rs-2", "rs-10"]);
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
