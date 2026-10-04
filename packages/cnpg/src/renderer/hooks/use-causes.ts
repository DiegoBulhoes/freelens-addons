import { useEffect, useState } from "react";

import { readCause } from "../api/actions";
import type { ClusterLike } from "../api/types";

const FRESH_MS = 60_000;
const cache = new Map<string, { at: number; cause?: string }>();

export const causeKey = (cluster: { getNs(): string | undefined; getName(): string }) =>
  `${cluster.getNs()}/${cluster.getName()}`;

/** Barman's last error for each cluster given, read from its log; a minute old at most. */
export function useCauses(clusters: ClusterLike[]): Map<string, string> {
  const [, setVersion] = useState(0);
  const keys = clusters.map(causeKey).sort().join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: keys stands for the clusters, which are fresh objects every render.
  useEffect(() => {
    let cancelled = false;

    for (const cluster of clusters) {
      const key = causeKey(cluster);
      const known = cache.get(key);

      if (known && Date.now() - known.at < FRESH_MS) continue;

      cache.set(key, { at: Date.now(), cause: known?.cause });
      void readCause(cluster)
        .then((cause) => cache.set(key, { at: Date.now(), cause }))
        .catch(() => undefined)
        .then(() => {
          if (!cancelled) setVersion((version) => version + 1);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [keys]);

  const found = new Map<string, string>();

  for (const cluster of clusters) {
    const cause = cache.get(causeKey(cluster))?.cause;

    if (cause) found.set(causeKey(cluster), cause);
  }

  return found;
}
