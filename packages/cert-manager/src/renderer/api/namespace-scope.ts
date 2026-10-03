// Stores are shared and keep what a wider scope fetched until reloaded, and TLS Secrets
// are listed cluster-wide, so pages filter too. ClusterIssuers are never filtered out.
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
