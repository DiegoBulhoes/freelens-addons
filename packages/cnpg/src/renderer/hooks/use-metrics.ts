import { useEffect, useState } from "react";

import { readMetrics } from "../api/actions";
import { type Metrics, parseMetrics } from "../api/summary";
import type { ClusterLike } from "../api/types";

const REFRESH_MS = 30_000;

/** The primary's uptime and database sizes, from its exporter, while the drawer is open. */
export function useMetrics(cluster: ClusterLike | undefined): Metrics | undefined {
  const [metrics, setMetrics] = useState<Metrics>();
  const primary = cluster?.status?.currentPrimary;
  const key = cluster ? `${cluster.getNs()}/${primary}` : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for the cluster and its primary.
  useEffect(() => {
    setMetrics(undefined);

    if (!cluster || !primary) return;

    let cancelled = false;
    const read = () =>
      void readMetrics(cluster, primary)
        .then((text) => {
          if (!cancelled) setMetrics(parseMetrics(text));
        })
        .catch(() => undefined);

    read();
    const timer = setInterval(read, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);

  return metrics;
}
