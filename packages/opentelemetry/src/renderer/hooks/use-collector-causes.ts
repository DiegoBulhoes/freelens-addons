import { useEffect, useState } from "react";
import {
  afterRead,
  type CauseRead,
  causeKey,
  isDue,
  readSlots,
  retryIn,
  startRead,
} from "../api/collectors/causes";
import type { PodLike } from "../api/shared/types";
import { readPreviousLog } from "../api/writes/actions";

/** Read once per crash: a key names the pod and its restart count. */
const cache = new Map<string, CauseRead>();
// Module-wide, so two mounted pages together stay under the cap.
let inFlight = 0;

// A read can outlive the page that started it, so every mounted page hears when one lands.
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** Each crashing collector pod's cause, from its previous run's log. */
export function useCollectorCauses(pods: PodLike[]): ReadonlyMap<string, string> {
  const [tick, setTick] = useState(0);
  const keys = pods.map(causeKey).sort().join(",");

  useEffect(() => {
    const listener = () => setTick((current) => current + 1);

    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keys stands for the pods, which are fresh objects every render.
  useEffect(() => {
    const now = Date.now();
    const due = pods
      .filter((pod) => isDue(cache.get(causeKey(pod)), now))
      .sort((a, b) => causeKey(a).localeCompare(causeKey(b)))
      .slice(0, readSlots(inFlight));

    for (const pod of due) {
      const key = causeKey(pod);
      const started = startRead(cache.get(key));

      cache.set(key, started);
      inFlight += 1;
      void readPreviousLog(pod)
        .then(
          (log) => cache.set(key, afterRead(started, { log }, Date.now())),
          (error: unknown) => cache.set(key, afterRead(started, { error }, Date.now())),
        )
        .finally(() => {
          inFlight -= 1;
          notify();
        });
    }

    const wait = retryIn(
      pods.map((pod) => cache.get(causeKey(pod))),
      now,
    );
    const retry =
      wait === undefined ? undefined : setTimeout(() => setTick((current) => current + 1), wait);

    return () => clearTimeout(retry);
  }, [keys, tick]);

  const causes = new Map<string, string>();

  for (const pod of pods) {
    const cause = cache.get(causeKey(pod))?.cause;

    if (cause) causes.set(causeKey(pod), cause);
  }

  return causes;
}
