export type Index<T> = WeakMap<T[], Map<string, T>>;

// Built once per list, first match kept; the pages pass a fresh list every render.
export function firstBy<T>(cache: Index<T>, list: T[], keyOf: (item: T) => string): Map<string, T> {
  let byKey = cache.get(list);

  if (!byKey) {
    byKey = new Map();

    for (const item of list) {
      const key = keyOf(item);

      if (!byKey.has(key)) byKey.set(key, item);
    }

    cache.set(list, byKey);
  }

  return byKey;
}
