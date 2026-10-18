/** Stores are shared and keep a wider scope's items until reloaded, so filter here too. */
export function withinScope<Item extends { getNs(): string | undefined }>(
  items: Item[],
  namespaces: readonly string[],
): Item[] {
  const wanted = new Set(namespaces);

  return items.filter((item) => wanted.has(item.getNs() ?? ""));
}

export function scopeKey(namespaces: readonly string[]): string {
  return [...namespaces].sort().join(",");
}
