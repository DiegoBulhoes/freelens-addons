import { useEffect, useState } from "react";
import {
  type AgentRead,
  type AgentReadOutcome,
  type AgentView,
  afterAgentRead,
  agentsError,
  startAgentRead,
} from "../api/clusters/agent";
import { dueReads, FRESH_MS } from "../api/shared/polling";
import { readAgentOf } from "../api/writes/actions";

const reads = new Map<string, AgentRead>();
// Module-wide, so the overview and a drawer together stay under the cap.
let inFlight = 0;

const listeners = new Set<() => void>();
let notifyPending = false;

// One re-render for a burst of answers, not one per answer.
function notifySoon() {
  if (notifyPending) return;
  notifyPending = true;
  setTimeout(() => {
    notifyPending = false;
    for (const listener of listeners) listener();
  }, 200);
}

/** Each "namespace/pod" agent's view, refreshed every 15s while mounted and shown. */
export function useAgents(keys: string[]): {
  agents: Record<string, AgentView | undefined>;
  /** Why the agents could not be read, when none could. */
  error?: string;
} {
  const [, setVersion] = useState(0);
  const joined = [...keys].sort().join(",");

  useEffect(() => {
    const wanted = joined ? joined.split(",") : [];

    const startDueReads = () => {
      if (document.visibilityState === "hidden") return;

      for (const key of dueReads(wanted, reads, Date.now(), inFlight)) {
        const [namespace = "", pod = ""] = key.split("/");

        reads.set(key, startAgentRead(reads.get(key)));
        inFlight += 1;
        void readAgentOf(namespace, pod)
          .then(
            (view): AgentReadOutcome => ({ view }),
            (error: unknown): AgentReadOutcome => ({
              failed: error instanceof Error ? error.message : String(error),
            }),
          )
          .then((outcome) => reads.set(key, afterAgentRead(reads.get(key), Date.now(), outcome)))
          .finally(() => {
            inFlight -= 1;
            notifySoon();
          });
      }
    };
    // A read ending frees a slot, so the next due key starts then, not a tick later.
    const onRead = () => {
      setVersion((version) => version + 1);
      startDueReads();
    };

    listeners.add(onRead);
    startDueReads();
    const timer = setInterval(startDueReads, FRESH_MS);

    return () => {
      listeners.delete(onRead);
      clearInterval(timer);
    };
  }, [joined]);

  return {
    agents: Object.fromEntries(keys.map((key) => [key, reads.get(key)?.view])),
    error: agentsError(keys.map((key) => reads.get(key))),
  };
}
