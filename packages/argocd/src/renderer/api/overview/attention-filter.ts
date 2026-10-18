import { Application } from "../applications/application";
import { idOf } from "../shared/identity";
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

/** Empty chips are hidden, except All and the active one: a remembered filter can drain to nothing. */
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

/** Relies on a stable sort to keep severity order within each group. */
export function sortPinnedFirst(items: AttentionItem[], pinnedIds: Set<string>): AttentionItem[] {
  if (pinnedIds.size === 0) return items;

  const rankOf = (item: AttentionItem) => (pinnedIds.has(idOf(item.application)) ? 0 : 1);

  return [...items].sort((first, second) => rankOf(first) - rankOf(second));
}

export interface AttentionView {
  /** The rows to list: filtered, searched, pinned first. */
  ordered: AttentionItem[];
  /** For the headline: every Application needing attention, whatever the chips and search hide. */
  needingAttention: number;
}

export function viewAttention(
  items: AttentionItem[],
  selection: AttentionSelection,
): AttentionView {
  return {
    ordered: sortPinnedFirst(selectAttentionItems(items, selection), selection.pinnedIds),
    needingAttention: items.length,
  };
}
