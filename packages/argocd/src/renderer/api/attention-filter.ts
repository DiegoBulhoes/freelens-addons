import { Application } from "./application";
import { idOf } from "./identity";
import type { AttentionItem } from "./overview";

export type FilterKey = "all" | "mine" | "broken" | "failed-sync" | "drift" | "progressing";

export const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  mine: "Pinned",
  broken: "Degraded",
  "failed-sync": "Failed sync",
  drift: "OutOfSync",
  progressing: "Progressing",
};

export function isFilterKey(candidate: string | undefined): candidate is FilterKey {
  return candidate !== undefined && Object.hasOwn(FILTER_LABELS, candidate);
}

export function matchesFilter(
  item: AttentionItem,
  filter: FilterKey,
  pinnedIds: Set<string>,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "mine":
      return pinnedIds.has(idOf(item.application));
    case "broken":
      return item.headline === "Degraded" || item.headline === "Missing";
    case "failed-sync":
      return item.headline.startsWith("Last sync");
    case "drift":
      return item.headline === "OutOfSync";
    case "progressing":
      return item.headline === "Progressing";
  }
}

function searchableTextOf(item: AttentionItem): string {
  const { application } = item;

  return [
    application.getName(),
    Application.getProject(application),
    Application.getDestination(application),
  ]
    .join(" ")
    .toLowerCase();
}

export interface FilterChip {
  key: FilterKey;
  total: number;
}

/**
 * The chips the attention section offers, each with how many rows it would show.
 *
 * An empty filter is left out — a chip that leads to nothing is noise — except
 * All, and except the one in use. The filter is remembered across restarts, and
 * what it matched can drain away in between: a Progressing Application settles.
 * Hiding the chip then would leave an empty list with nothing lit to say why,
 * and nothing to press that says so.
 */
export function filterChips(
  items: AttentionItem[],
  active: FilterKey,
  pinnedIds: Set<string>,
): FilterChip[] {
  return (Object.keys(FILTER_LABELS) as FilterKey[])
    .map((key) => ({
      key,
      total: items.filter((item) => matchesFilter(item, key, pinnedIds)).length,
    }))
    .filter((chip) => chip.total > 0 || chip.key === "all" || chip.key === active);
}

export function matchesSearch(item: AttentionItem, searchText: string): boolean {
  const needle = searchText.trim().toLowerCase();

  if (!needle) return true;

  return searchableTextOf(item).includes(needle);
}

export interface AttentionSelection {
  filter: FilterKey;
  searchText: string;
  pinnedIds: Set<string>;
}

export function selectAttentionItems(
  items: AttentionItem[],
  { filter, searchText, pinnedIds }: AttentionSelection,
): AttentionItem[] {
  return items.filter(
    (item) => matchesFilter(item, filter, pinnedIds) && matchesSearch(item, searchText),
  );
}

/** Relies on sort being stable: severity order has to survive inside each group. */
export function sortPinnedFirst(items: AttentionItem[], pinnedIds: Set<string>): AttentionItem[] {
  if (pinnedIds.size === 0) return items;

  const rankOf = (item: AttentionItem) => (pinnedIds.has(idOf(item.application)) ? 0 : 1);

  return [...items].sort((first, second) => rankOf(first) - rankOf(second));
}

export interface Page<Item> {
  items: Item[];
  pageIndex: number;
  pageCount: number;
  firstItemNumber: number;
  lastItemNumber: number;
}

export function pageOf<Item>(items: Item[], requestedPage: number, pageSize: number): Page<Item> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const pageIndex = Math.min(Math.max(requestedPage, 0), pageCount - 1);
  const start = pageIndex * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    pageIndex,
    pageCount,
    firstItemNumber: items.length === 0 ? 0 : start + 1,
    lastItemNumber: Math.min(start + pageSize, items.length),
  };
}
