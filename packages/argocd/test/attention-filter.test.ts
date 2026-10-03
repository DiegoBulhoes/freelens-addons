import { describe, expect, it } from "vitest";
import {
  FILTER_LABELS,
  type FilterKey,
  filterChips,
  isFilterKey,
  matchesFilter,
  matchesSearch,
  pageOf,
  selectAttentionItems,
  sortPinnedFirst,
} from "../src/renderer/api/attention-filter";
import { idOf } from "../src/renderer/api/identity";
import { type AttentionItem, getAttentionItems } from "../src/renderer/api/overview";
import { applications, fixtureNow } from "./fixtures";

const NOW = fixtureNow();

function attentionItems(): AttentionItem[] {
  return getAttentionItems(applications(), NOW);
}

function idsOf(items: AttentionItem[]): string[] {
  return items.map((item) => idOf(item.application));
}

const NO_IDS = new Set<string>();

describe("filtering the attention list", () => {
  it("keeps everything under the all filter", () => {
    const items = attentionItems();

    expect(items.length).toBeGreaterThan(0);
    expect(
      selectAttentionItems(items, {
        filter: "all",
        searchText: "",
        pinnedIds: NO_IDS,
      }),
    ).toHaveLength(items.length);
  });

  it("narrows to a single headline, and every survivor really has it", () => {
    const drifting = selectAttentionItems(attentionItems(), {
      filter: "drift",
      searchText: "",
      pinnedIds: NO_IDS,
    });

    expect(drifting.length).toBeGreaterThan(0);

    for (const item of drifting) {
      expect(item.headline).toBe("OutOfSync");
    }
  });

  it("matches the search against the name, the project and the destination", () => {
    const [item] = attentionItems();

    expect(item).toBeDefined();

    const target = item as AttentionItem;

    expect(matchesSearch(target, target.application.getName())).toBe(true);
    expect(matchesSearch(target, target.application.spec.project)).toBe(true);
    expect(matchesSearch(target, target.application.spec.destination.namespace ?? "")).toBe(true);
  });

  it("shows only pinned Applications under the pinned filter", () => {
    const items = attentionItems();
    const pinnedId = idOf((items[1] as AttentionItem).application);

    const mine = selectAttentionItems(items, {
      filter: "mine",
      searchText: "",
      pinnedIds: new Set([pinnedId]),
    });

    expect(idsOf(mine)).toEqual([pinnedId]);
  });

  it("applies the filter and the search together rather than one of the two", () => {
    const items = attentionItems();
    const drifting = items.find((item) => item.headline === "OutOfSync") as AttentionItem;

    expect(drifting).toBeDefined();

    // A matching search must not override the filter.
    const remaining = selectAttentionItems(items, {
      filter: "broken",
      searchText: drifting.application.getName(),
      pinnedIds: NO_IDS,
    });

    expect(idsOf(remaining)).not.toContain(idOf(drifting.application));
  });
});

describe("filtering when nothing matches", () => {
  it("returns nothing, rather than everything, for a search that matches no row", () => {
    const remaining = selectAttentionItems(attentionItems(), {
      filter: "all",
      searchText: "no-application-is-called-this",
      pinnedIds: NO_IDS,
    });

    expect(remaining).toEqual([]);
  });

  it("returns nothing for the pinned filter when nothing is pinned", () => {
    const remaining = selectAttentionItems(attentionItems(), {
      filter: "mine",
      searchText: "",
      pinnedIds: NO_IDS,
    });

    expect(remaining).toEqual([]);
  });

  it("handles an empty list without throwing", () => {
    expect(
      selectAttentionItems([], {
        filter: "drift",
        searchText: "anything",
        pinnedIds: NO_IDS,
      }),
    ).toEqual([]);
  });
});

describe("the chips offered", () => {
  it("offers All with every row, and each other filter only when it matches something", () => {
    const items = attentionItems();
    const chips = filterChips(items, "all", NO_IDS);

    expect(chips[0]).toEqual({ key: "all", total: items.length });

    for (const chip of chips.slice(1)) {
      expect(chip.total, chip.key).toBeGreaterThan(0);
      expect(chip.total).toBe(
        selectAttentionItems(items, { filter: chip.key, searchText: "", pinnedIds: NO_IDS }).length,
      );
    }

    expect(chips.map((chip) => chip.key)).not.toContain("mine");
  });

  it("keeps the chip in use, empty, so an empty list says which filter emptied it", () => {
    const chips = filterChips(attentionItems(), "mine", NO_IDS);

    expect(chips).toContainEqual({ key: "mine", total: 0 });
  });

  it("offers All alone when nothing needs attention", () => {
    expect(filterChips([], "all", NO_IDS)).toEqual([{ key: "all", total: 0 }]);
  });
});

describe("filtering given input nobody expects", () => {
  it("treats whitespace as no search at all", () => {
    const items = attentionItems();

    expect(
      selectAttentionItems(items, {
        filter: "all",
        searchText: "   ",
        pinnedIds: NO_IDS,
      }),
    ).toHaveLength(items.length);
  });

  it("searches case-insensitively, in both directions", () => {
    const [item] = attentionItems();
    const name = (item as AttentionItem).application.getName();

    expect(matchesSearch(item as AttentionItem, name.toUpperCase())).toBe(true);
    expect(matchesSearch(item as AttentionItem, name.toLowerCase())).toBe(true);
  });

  it("answers every filter key without falling through", () => {
    const [item] = attentionItems();

    for (const key of Object.keys(FILTER_LABELS) as FilterKey[]) {
      expect(typeof matchesFilter(item as AttentionItem, key, NO_IDS)).toBe("boolean");
    }
  });

  it("rejects a stored filter that is no longer one of ours", () => {
    expect(isFilterKey("drift")).toBe(true);
    expect(isFilterKey("a-filter-that-was-renamed")).toBe(false);
    expect(isFilterKey(undefined)).toBe(false);
    // A key of Object.prototype is not a filter, however `in` behaves.
    expect(isFilterKey("toString")).toBe(false);
  });
});

describe("sorting pinned Applications to the top", () => {
  it("lifts the pinned one without reordering the rest", () => {
    const items = attentionItems();
    const pinnedId = idOf((items[2] as AttentionItem).application);

    const sorted = sortPinnedFirst(items, new Set([pinnedId]));

    expect(idsOf(sorted)[0]).toBe(pinnedId);
    expect(idsOf(sorted.slice(1))).toEqual(
      idsOf(items.filter((item) => idOf(item.application) !== pinnedId)),
    );
  });

  it("keeps the original order when nothing is pinned", () => {
    const items = attentionItems();

    expect(sortPinnedFirst(items, NO_IDS)).toBe(items);
  });

  it("does not mutate the list it was given", () => {
    const items = attentionItems();
    const before = idsOf(items);

    sortPinnedFirst(items, new Set([idOf((items[3] as AttentionItem).application)]));

    expect(idsOf(items)).toEqual(before);
  });
});

describe("paging the rows", () => {
  const rows = Array.from({ length: 20 }, (_, index) => `row-${index + 1}`);

  it("returns the first page and counts the rest", () => {
    const page = pageOf(rows, 0, 8);

    expect(page.items).toHaveLength(8);
    expect(page.items[0]).toBe("row-1");
    expect(page.pageCount).toBe(3);
    expect(page.firstItemNumber).toBe(1);
    expect(page.lastItemNumber).toBe(8);
  });

  it("returns a short last page with the numbers to match", () => {
    const page = pageOf(rows, 2, 8);

    expect(page.items).toHaveLength(4);
    expect(page.firstItemNumber).toBe(17);
    expect(page.lastItemNumber).toBe(20);
  });

  it("clamps a cursor left past the end by a filter change", () => {
    const page = pageOf(rows, 99, 8);

    // An out-of-range page clamps to the last one.
    expect(page.pageIndex).toBe(2);
    expect(page.items).toHaveLength(4);
  });

  it("clamps a negative cursor to the first page", () => {
    expect(pageOf(rows, -5, 8).pageIndex).toBe(0);
  });

  it("reports one empty page for an empty list, numbered from zero", () => {
    const page = pageOf([], 0, 8);

    expect(page.items).toEqual([]);
    expect(page.pageCount).toBe(1);
    expect(page.firstItemNumber).toBe(0);
    expect(page.lastItemNumber).toBe(0);
  });

  it("puts everything on one page when the list is shorter than a page", () => {
    const page = pageOf(rows.slice(0, 3), 0, 8);

    expect(page.pageCount).toBe(1);
    expect(page.lastItemNumber).toBe(3);
  });
});
