export interface Cut<Item> {
  shown: Item[];
  hidden: number;
}

/** The first `limit` items, or every one once `all` is set. */
export function cutTo<Item>(items: Item[], limit: number, all = false): Cut<Item> {
  const shown = all ? items : items.slice(0, limit);

  return { shown, hidden: items.length - shown.length };
}
