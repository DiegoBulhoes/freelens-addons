import { describe, expect, it } from "vitest";

import {
  checkSearchTexts,
  checkSortValue,
  getRoleFindings,
  groupByCheck,
} from "../src/renderer/api/rbac";
import { rankOf } from "../src/renderer/api/severity";
import { describeCount, nextSort, searchRows, sortRows } from "../src/renderer/api/table";
import { allRbacReports } from "./fixtures";

const groups = () => groupByCheck(getRoleFindings(allRbacReports()));

describe("searching a list", () => {
  it("finds every check that flags a role, by the role's name", () => {
    const all = groups();
    const role = all[0]?.findings[0]?.subject.name as string;
    const found = searchRows(all, role, checkSearchTexts);

    expect(found.length).toBeGreaterThan(0);
    for (const group of found) {
      expect(checkSearchTexts(group).join(" ")).toContain(role);
    }
  });

  it("keeps rows whose texts contain every word, ignoring case", () => {
    const all = groups();
    const first = all[0];
    const words = `${first?.checkID.toLowerCase()} ${first?.severity}`;

    expect(searchRows(all, words, checkSearchTexts)).toContain(first);
    expect(searchRows(all, `${first?.checkID} no-such-word`, checkSearchTexts)).toEqual([]);
  });

  it("returns every row for an empty query", () => {
    const all = groups();

    expect(searchRows(all, "  ", checkSearchTexts)).toHaveLength(all.length);
  });
});

describe("sorting a list", () => {
  it("opens worst first when sorted by severity ascending", () => {
    const sorted = sortRows(
      groups(),
      { column: "Severity", direction: "ascending" },
      checkSortValue,
    );
    const ranks = sorted.map((group) => rankOf(group.severity));

    expect(ranks).toEqual([...ranks].sort((first, second) => first - second));
  });

  it("orders by how many roles fail a check, either way", () => {
    for (const direction of ["ascending", "descending"] as const) {
      const counts = sortRows(groups(), { column: "Roles", direction }, checkSortValue).map(
        (group) => checkSortValue(group, "Roles") as number,
      );
      const expected = [...counts].sort((first, second) =>
        direction === "ascending" ? first - second : second - first,
      );

      expect(counts).toEqual(expected);
    }
  });

  it("orders check titles and ids as people read numbers in them", () => {
    const titles = sortRows(
      groups(),
      { column: "Check", direction: "ascending" },
      checkSortValue,
    ).map((group) => group.title);

    expect(titles).toEqual(
      [...titles].sort((first, second) =>
        first.localeCompare(second, undefined, { numeric: true }),
      ),
    );
    expect(
      sortRows(groups(), { column: "ID", direction: "descending" }, checkSortValue)[0]?.checkID,
    ).toBeTruthy();
  });

  it("puts a row without a value last in both directions", () => {
    const [first, second] = groups();
    const unnamed = { ...(second as NonNullable<typeof second>), checkID: "" };
    const rows = [unnamed, first as NonNullable<typeof first>];

    for (const direction of ["ascending", "descending"] as const) {
      expect(sortRows(rows, { column: "ID", direction }, checkSortValue).at(-1)).toBe(unnamed);
    }
  });

  it("keeps the incoming order without a sort, or for a column it does not know", () => {
    const all = groups();

    expect(sortRows(all, undefined, checkSortValue)).toBe(all);
    expect(sortRows(all, { column: "Nothing", direction: "ascending" }, checkSortValue)).toEqual(
      all,
    );
  });

  it("cycles a header through ascending, descending and none", () => {
    const first = nextSort(undefined, "Roles");
    const second = nextSort(first, "Roles");

    expect(first?.direction).toBe("ascending");
    expect(second?.direction).toBe("descending");
    expect(nextSort(second, "Roles")).toBeUndefined();
    expect(nextSort(second, "Check")).toEqual({ column: "Check", direction: "ascending" });
  });
});

describe("counting a list", () => {
  it("says how many, and how many of how many while narrowed", () => {
    const all = groups();

    expect(describeCount(all.length, all.length)).toBe(`${all.length} items`);
    expect(describeCount(1, 1)).toBe("1 item");
    expect(describeCount(1, all.length)).toBe(`1 of ${all.length} items`);
  });
});
