import { useEffect, useState } from "react";

import { readInstanceStatus } from "../api/actions";
import type { InstanceStatus } from "../api/types";

const FRESH_MS = 15_000;
const cache = new Map<string, { at: number; status?: InstanceStatus }>();

/** /pg/status of each "namespace/pod" given, refreshed every 15s while mounted. */
export function useInstanceStatuses(keys: string[]): Record<string, InstanceStatus | undefined> {
  const [, setVersion] = useState(0);
  const joined = [...keys].sort().join(",");

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      for (const key of joined ? joined.split(",") : []) {
        const known = cache.get(key);

        if (known && Date.now() - known.at < FRESH_MS) continue;

        const [namespace, pod] = key.split("/");

        cache.set(key, { at: Date.now(), status: known?.status });
        void readInstanceStatus(namespace, pod ?? "")
          .then((status) => cache.set(key, { at: Date.now(), status }))
          .catch(() => cache.set(key, { at: Date.now() }))
          .then(() => {
            if (!cancelled) setVersion((version) => version + 1);
          });
      }
    };

    refresh();
    const timer = setInterval(refresh, FRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [joined]);

  return Object.fromEntries(keys.map((key) => [key, cache.get(key)?.status]));
}
