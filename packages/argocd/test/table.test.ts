import { describe, expect, it } from "vitest";

import { Application } from "../src/renderer/api/application";
import { describeCount, nextSort, searchRows, sortRows } from "../src/renderer/api/table";
import { applications } from "./fixtures";

const nameOf = (application: Application) => application.getName();
const chartOf = (application: Application) =>
  Application.getSources(application).find((source) => source.chart)?.chart;
const valueAt = (application: Application, column: string) =>
  column === "Chart" ? chartOf(application) : application.getName();

describe("searching a list", () => {
  it("keeps rows whose texts contain every word, ignoring case", () => {
    const found = searchRows(applications(), "GUESTBOOK helm", (row) => [row.getName()]);

    expect(found.map(nameOf)).toEqual(["helm-guestbook"]);
  });

  it("matches a word in any of the row's texts", () => {
    const found = searchRows(applications(), "guestbook demo", (row) => [
      row.getName(),
      Application.getProject(row),
    ]);

    expect(found.length).toBeGreaterThan(1);
    expect(found.every((row) => row.getName().includes("guestbook"))).toBe(true);
    expect(found.every((row) => Application.getProject(row) === "demo")).toBe(true);
  });

  it("returns every row for an empty query", () => {
    const all = applications();

    expect(searchRows(all, "  ", (row) => [row.getName()])).toBe(all);
  });
});

describe("sorting a list", () => {
  it("orders names as people read them", () => {
    const sorted = sortRows(applications(), { column: "Name", direction: "ascending" }, valueAt);
    const names = sorted.map(nameOf);

    expect(names).toEqual(
      [...names].sort((first, second) => first.localeCompare(second, undefined, { numeric: true })),
    );
    expect(
      sortRows(applications(), { column: "Name", direction: "descending" }, valueAt)[0]?.getName(),
    ).toBe(names.at(-1));
  });

  it("puts the rows without a value last in both directions", () => {
    const missing = applications().filter((row) => chartOf(row) === undefined);

    expect(missing.length, "some Applications come from git, not a chart").toBeGreaterThan(0);
    expect(missing.length, "some come from a chart").toBeLessThan(applications().length);

    for (const direction of ["ascending", "descending"] as const) {
      const sorted = sortRows(applications(), { column: "Chart", direction }, valueAt);

      expect(sorted.slice(-missing.length).map(nameOf)).toEqual(missing.map(nameOf));
    }
  });

  it("keeps the incoming order without a sort", () => {
    const all = applications();

    expect(sortRows(all, undefined, valueAt)).toBe(all);
  });

  it("cycles a header through ascending, descending and none", () => {
    const first = nextSort(undefined, "Name");
    const second = nextSort(first, "Name");

    expect(first?.direction).toBe("ascending");
    expect(second?.direction).toBe("descending");
    expect(nextSort(second, "Name")).toBeUndefined();
    expect(nextSort(second, "Chart")).toEqual({ column: "Chart", direction: "ascending" });
  });
});

describe("counting a list", () => {
  it("says how many, and how many of how many while narrowed", () => {
    expect(describeCount(1, 1)).toBe("1 item");
    expect(describeCount(12, 12)).toBe("12 items");
    expect(describeCount(3, 12)).toBe("3 of 12 items");
  });
});
