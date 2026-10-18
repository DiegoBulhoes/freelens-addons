import { useEffect, useState } from "react";
import { dueReads, endRead, FRESH_MS, type PolledRead, startRead } from "../api/shared/polling";
import type { InstanceStatus } from "../api/shared/types";
import { readInstanceStatus } from "../api/writes/actions";

const reads = new Map<string, PolledRead<InstanceStatus | undefined>>();
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

/** /pg/status of each "namespace/pod" given, refreshed every 15s while mounted and shown. */
export function useInstanceStatuses(keys: string[]): Record<string, InstanceStatus | undefined> {
  const [, setVersion] = useState(0);
  const joined = [...keys].sort().join(",");

  useEffect(() => {
    const wanted = joined ? joined.split(",") : [];
    const listener = () => setVersion((version) => version + 1);

    const pump = () => {
      if (document.visibilityState === "hidden") return;

      for (const key of dueReads(wanted, reads, Date.now(), inFlight)) {
        const [namespace, pod] = key.split("/");

        reads.set(key, startRead(reads.get(key)));
        inFlight += 1;
        void readInstanceStatus(namespace, pod ?? "")
          .then(
            (value) => reads.set(key, endRead({ value }, Date.now())),
            (error: unknown) => reads.set(key, endRead({ error }, Date.now())),
          )
          .finally(() => {
            inFlight -= 1;
            notifySoon();
          });
      }
    };
    // A read ending frees a slot, so the next due key starts then, not a tick later.
    const onRead = () => {
      listener();
      pump();
    };

    listeners.add(onRead);
    pump();
    const timer = setInterval(pump, FRESH_MS);

    return () => {
      listeners.delete(onRead);
      clearInterval(timer);
    };
  }, [joined]);

  return Object.fromEntries(keys.map((key) => [key, reads.get(key)?.value]));
}
