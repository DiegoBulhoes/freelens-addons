// Stores are shared and keep what a wider scope fetched until reloaded, so pages filter too.
export function withinScope<Item extends { getNs(): string | undefined }>(
  items: Item[],
  namespaces: readonly string[],
): Item[] {
  const wanted = new Set(namespaces);

  return items.filter((item) => {
    const namespace = item.getNs();

    return !namespace || wanted.has(namespace);
  });
}

export function scopeKey(namespaces: readonly string[]): string {
  return [...namespaces].sort().join(",");
}

/** What a read of every namespace is keyed on: not their names, so a namespace created reloads nothing. */
export function everywhereKey(namespacesLoaded: boolean, scope: readonly string[]): string {
  return namespacesLoaded ? "*" : scopeKey(scope);
}

/** Every namespace known, or the scope until the Namespace list arrives. */
export function everyNamespace(known: readonly string[], scope: readonly string[]): string[] {
  return [...(known.length > 0 ? known : scope)];
}

/** Indexed once, so a lookup per row is not a scan of every item. */
export function byNamespace<Item extends { getNs(): string | undefined }>(
  items: readonly Item[],
): Map<string, Item[]> {
  const index = new Map<string, Item[]>();

  for (const item of items) {
    const namespace = item.getNs() ?? "";
    const list = index.get(namespace);

    if (list) list.push(item);
    else index.set(namespace, [item]);
  }

  return index;
}
