// Filtered here too: a shared store keeps an earlier, wider scope until its next load.
// A cluster-scoped object belongs to every scope.
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
