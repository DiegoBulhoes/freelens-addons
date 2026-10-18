import { describe, expect, it } from "vitest";
import {
  applicationsCell,
  describePicks,
  IMAGE_COLUMNS,
  IMAGE_SORT,
  imageSearchTexts,
  MAX_PICKS_SHOWN,
  picksCell,
  RULE_COLUMNS,
  RULE_SORT,
  ruleSearchTexts,
  UPDATE_COLUMNS,
  UPDATE_SORT,
  updateSearchTexts,
} from "../../src/renderer/api/image-updater/image-updater-tables";
import {
  recentUpdates,
  trackedImages,
  type UpdateRow,
} from "../../src/renderer/api/image-updater/image-updates";
import {
  type RuleRow,
  rankRules,
  stateRank,
} from "../../src/renderer/api/image-updater/rule-health";
import { keyFor } from "../../src/renderer/api/shared/identity";
import { searchRows, sortRows } from "../../src/renderer/api/shared/table";
import { applications, fixtureNow, imageUpdater, imageUpdaters } from "../support/fixtures";

const ranked = () => rankRules(imageUpdaters(), applications(), fixtureNow());
const nameOf = (row: RuleRow) => row.updater.getName();
const byRule = (row: RuleRow, column: string) => RULE_SORT[column]?.(row);

describe("sorting the rules", () => {
  it("sorts by state worst first, which is the order the page opens in", () => {
    const rows = ranked();

    expect(
      sortRows(rows, { column: RULE_COLUMNS.state, direction: "ascending" }, byRule).map(nameOf),
    ).toEqual(rows.map(nameOf));

    const descending = sortRows(
      rows,
      { column: RULE_COLUMNS.state, direction: "descending" },
      byRule,
    );

    expect(stateRank(descending[0]?.health.state ?? "ok")).toBeGreaterThanOrEqual(
      stateRank(descending.at(-1)?.health.state ?? "failing"),
    );
  });

  it("puts the most recent update first, and the rules that never updated last", () => {
    const sorted = sortRows(
      ranked(),
      { column: RULE_COLUMNS.lastUpdate, direction: "ascending" },
      byRule,
    ).map(nameOf);

    expect(sorted.slice(0, 2)).toEqual(["podinfo-chart", "podinfo-patches"]);

    const reversed = sortRows(
      ranked(),
      { column: RULE_COLUMNS.lastUpdate, direction: "descending" },
      byRule,
    ).map(nameOf);

    expect(reversed.slice(0, 2)).toEqual(["podinfo-patches", "podinfo-chart"]);
  });

  it("sorts the counts as numbers and the names as text", () => {
    const byApplications = sortRows(
      ranked(),
      { column: RULE_COLUMNS.applications, direction: "descending" },
      byRule,
    );
    const counts = byApplications.map((row) => row.updater.status?.applicationsMatched ?? 0);

    expect(counts).toEqual([...counts].sort((first, second) => second - first));
    expect(
      sortRows(ranked(), { column: RULE_COLUMNS.rule, direction: "ascending" }, byRule)
        .map(nameOf)
        .at(0),
    ).toBe("bad-pattern");
    expect(byRule(ranked()[0] as RuleRow, RULE_COLUMNS.images)).toBeTypeOf("number");
    expect(byRule(ranked()[0] as RuleRow, RULE_COLUMNS.checked)).toBeTypeOf("number");
  });
});

describe("searching the rules", () => {
  it("finds a rule by its name or by the state it is in", () => {
    const rows = ranked();

    expect(searchRows(rows, "podinfo", ruleSearchTexts).map(nameOf).sort()).toEqual([
      "podinfo-chart",
      "podinfo-patches",
    ]);

    const worst = rows[0] as RuleRow;
    const found = searchRows(rows, worst.health.label, ruleSearchTexts);

    expect(found.map(nameOf)).toContain(nameOf(worst));
    expect(found.every((row) => row.health.label === worst.health.label)).toBe(true);
  });
});

describe("the images", () => {
  const images = () => trackedImages(imageUpdaters(), applications());

  it("finds an image by an Application it reaches", () => {
    const found = searchRows(images(), "helm-image-updates", imageSearchTexts);

    expect(found.length).toBeGreaterThan(0);
    expect(
      found.every((image) => image.applications.some((each) => each.name === "helm-image-updates")),
    ).toBe(true);
  });

  it("sorts by rule, by how many Applications, and by where it writes", () => {
    const at = (image: ReturnType<typeof images>[number], column: string) =>
      IMAGE_SORT[column]?.(image);
    const rules = sortRows(
      images(),
      { column: IMAGE_COLUMNS.rule, direction: "ascending" },
      at,
    ).map((image) => image.updater);

    expect(rules).toEqual([...rules].sort((first, second) => first.localeCompare(second)));

    const reach = sortRows(
      images(),
      { column: IMAGE_COLUMNS.applications, direction: "descending" },
      at,
    ).map((image) => image.applications.length);

    expect(reach).toEqual([...reach].sort((first, second) => second - first));
    expect(
      new Set(images().map((image) => at(image, IMAGE_COLUMNS.writesTo))).has("Application"),
    ).toBe(true);
    expect(at(images()[0] as never, IMAGE_COLUMNS.image)).toBeTypeOf("string");
    expect(at(images()[0] as never, IMAGE_COLUMNS.picks)).toBeTypeOf("string");
  });
});

describe("the updates", () => {
  const updates = () => recentUpdates(imageUpdaters());
  const at = (update: ReturnType<typeof updates>[number], column: string) =>
    UPDATE_SORT[column]?.(update);

  it("sorts the newest first by when, and by any other column", () => {
    expect(
      sortRows(updates(), { column: UPDATE_COLUMNS.when, direction: "ascending" }, at).map(
        (update) => update.updater,
      ),
    ).toEqual(["podinfo-chart", "podinfo-patches"]);

    for (const column of [
      UPDATE_COLUMNS.image,
      UPDATE_COLUMNS.from,
      UPDATE_COLUMNS.to,
      UPDATE_COLUMNS.applications,
      UPDATE_COLUMNS.rule,
    ]) {
      expect(updates().every((update) => at(update, column) !== undefined)).toBe(true);
    }
  });

  it("finds an update by the tag it left or its rule", () => {
    expect(searchRows(updates(), "6.13.0", updateSearchTexts)).toHaveLength(2);
    expect(searchRows(updates(), "chart", updateSearchTexts).map((each) => each.updater)).toEqual([
      "podinfo-chart",
    ]);
    expect(updateSearchTexts({ ...(updates()[0] as UpdateRow), from: undefined })).toContain("");
  });

  it("keys a row to its rule by namespace and name", () => {
    const [update] = updates();

    expect(keyFor(update?.updater ?? "", update?.namespace)).toBe("argocd/podinfo-chart");
    expect(keyFor("orphan", undefined)).toBe("/orphan");
  });
});

describe("the cells of an image row", () => {
  const imageOf = (updater: ReturnType<typeof imageUpdater>) => {
    const [image] = trackedImages([updater], applications());

    if (!image) throw new Error(`${updater.getName()} names no image in the fixtures`);

    return image;
  };

  it("show a short choice whole", () => {
    const image = imageOf(imageUpdater("podinfo-patches"));

    expect(picksCell(image)).toEqual({
      label: describePicks(image),
      title: describePicks(image),
    });
  });

  it("cut a long tag filter short, and keep it whole in the tooltip", () => {
    const filtered = imageUpdater("podinfo-patches");
    const [ref] = filtered.spec.applicationRefs;
    const [watched] = ref?.images ?? [];

    if (!watched) throw new Error("podinfo-patches names no image in the fixtures");
    watched.commonUpdateSettings = {
      ...watched.commonUpdateSettings,
      allowTags: "regexp:^6\\.14\\.[0-9]+(-rc\\.[0-9]+)?$",
    };

    const cell = picksCell(imageOf(filtered));

    expect(cell.title).toContain("tags matching regexp:^6");
    expect(cell.label).toHaveLength(MAX_PICKS_SHOWN);
    expect(cell.label.endsWith("…")).toBe(true);
    expect(cell.title.startsWith(cell.label.slice(0, -1))).toBe(true);
  });

  it("link the one Application an image reaches, and say none when it reaches none", () => {
    const one = applicationsCell(imageOf(imageUpdater("podinfo-patches")));

    expect(one).toMatchObject({ kind: "one", watched: { name: "image-updates" } });
    expect(applicationsCell(imageOf(imageUpdater("retired")))).toEqual({ kind: "none" });
  });

  it("count several Applications instead of naming each in the row", () => {
    const wide = imageUpdater("podinfo-patches");
    (wide.spec.applicationRefs[0] as { namePattern: string }).namePattern = "*image-updates";

    const image = imageOf(wide);
    const cell = applicationsCell(image);
    const names = image.applications.map((each) => each.name);

    expect(names).toEqual(expect.arrayContaining(["image-updates", "helm-image-updates"]));
    expect(cell).toMatchObject({ kind: "many", count: names.length });

    const state = (each: (typeof image.applications)[number]) =>
      each.skipped ? `skipped, ${each.skipped}` : (each.running ?? "not running it");

    expect(cell.kind === "many" && cell.title.split("\n").slice(0, -1)).toEqual(
      image.applications.map((each) => `${each.name}: ${state(each)}`),
    );
  });

  it("say in the count's tooltip why an Application is skipped", () => {
    const wide = imageUpdater("plain-manifests");
    (wide.spec.applicationRefs[0] as { namePattern: string }).namePattern = "guestbook*";

    const image = imageOf(wide);
    const skipped = image.applications.find((each) => each.skipped);
    const cell = applicationsCell(image);

    if (!skipped) throw new Error("guestbook* skips no Application in the fixtures");
    expect(cell.kind).toBe("many");
    expect(cell.kind === "many" && cell.title).toContain(
      `${skipped.name}: skipped, ${skipped.skipped}`,
    );
  });
});
