import { useEffect, useState } from "react";

import {
  type ClusterPressure,
  getClusterPressure,
  listNodeWarnings,
  type NodeEvent,
  PRESSURE_STORES,
} from "../api/overview/cluster-health";
import { useLoadedStores } from "./load-stores";

const TICK_MS = 60_000;

export function useClusterPressure(): ClusterPressure[] {
  const [now, setNow] = useState(Date.now);
  const [events, setEvents] = useState<NodeEvent[]>([]);

  useLoadedStores(PRESSURE_STORES);

  // Read again each minute, which also lets a warning leave the one-hour window.
  useEffect(() => {
    let cancelled = false;
    let reading = false;
    const read = async () => {
      // One read at a time: a slow API server must not stack them up.
      if (reading) return;
      reading = true;

      try {
        const listed = await listNodeWarnings();

        if (!cancelled) setEvents(listed);
      } finally {
        reading = false;
      }

      if (!cancelled) setNow(Date.now());
    };

    void read();
    const timer = setInterval(() => void read(), TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return getClusterPressure(events, now);
}
