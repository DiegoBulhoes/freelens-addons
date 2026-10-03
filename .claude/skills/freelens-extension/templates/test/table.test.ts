import { describe, expect, it } from "vitest";

import { describeCount, nextSort, searchRows, sortRows } from "../src/renderer/api/table";

// Template only: an extension tests its own search and sort against real fixtures.
const rows = [
  { name: "web-2", age: 10 },
  { name: "api", age: undefined },
  { name: "web-10", age: 3 },
];

describe("searching a list", () => {
  it("keeps rows whose texts contain every word, ignoring case", () => {
    expect(searchRows(rows, "WEB 1", (row) => [row.name]).map((row) => row.name)).toEqual([
      "web-10",
    ]);
  });

  it("returns every row for an empty query", () => {
    expect(searchRows(rows, "  ", (row) => [row.name])).toHaveLength(3);
  });
});

describe("sorting a list", () => {
  const valueAt = (row: (typeof rows)[number], column: string) =>
    column === "age" ? row.age : row.name;

  it("orders names as people read numbers in them", () => {
    expect(
      sortRows(rows, { column: "name", direction: "ascending" }, valueAt).map((row) => row.name),
    ).toEqual(["api", "web-2", "web-10"]);
  });

  it("puts empty values last in both directions", () => {
    for (const direction of ["ascending", "descending"] as const) {
      expect(sortRows(rows, { column: "age", direction }, valueAt).at(-1)?.name).toBe("api");
    }
  });

  it("keeps the incoming order without a sort", () => {
    expect(sortRows(rows, undefined, valueAt)).toBe(rows);
  });

  it("cycles a header through ascending, descending and none", () => {
    const first = nextSort(undefined, "name");
    const second = nextSort(first, "name");

    expect(first?.direction).toBe("ascending");
    expect(second?.direction).toBe("descending");
    expect(nextSort(second, "name")).toBeUndefined();
    expect(nextSort(second, "age")).toEqual({ column: "age", direction: "ascending" });
  });
});

describe("counting a list", () => {
  it("says how many, and how many of how many while narrowed", () => {
    expect(describeCount(1, 1)).toBe("1 item");
    expect(describeCount(12, 12)).toBe("12 items");
    expect(describeCount(3, 12)).toBe("3 of 12 items");
  });
});
