import { useEffect, useState } from "react";

import { readAgentOf } from "../api/actions";
import type { AgentView } from "../api/agent";

const FRESH_MS = 15_000;
const cache = new Map<string, { at: number; view?: AgentView; failed?: string }>();

/** Each "namespace/pod" agent's view, refreshed every 15s while mounted. */
export function useAgents(keys: string[]): {
  agents: Record<string, AgentView | undefined>;
  /** Why the agents could not be read, when none could. */
  error?: string;
} {
  const [, setVersion] = useState(0);
  const joined = [...keys].sort().join(",");

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      for (const key of joined ? joined.split(",") : []) {
        const known = cache.get(key);

        if (known && Date.now() - known.at < FRESH_MS) continue;

        const [namespace = "", pod = ""] = key.split("/");

        cache.set(key, { ...known, at: Date.now() });
        void readAgentOf(namespace, pod)
          .then((view) => cache.set(key, { at: Date.now(), view }))
          .catch((error: unknown) =>
            cache.set(key, {
              at: Date.now(),
              failed: error instanceof Error ? error.message : String(error),
            }),
          )
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

  const read = keys.map((key) => cache.get(key));
  const allFailed = read.length > 0 && read.every((each) => each?.failed);

  return {
    agents: Object.fromEntries(keys.map((key) => [key, cache.get(key)?.view])),
    error: allFailed ? read[0]?.failed : undefined,
  };
}
