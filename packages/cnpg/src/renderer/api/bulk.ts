import { refusal, scheduleBackupRefusal } from "./operations";
import type { ClusterLike, PoolerLike, ScheduledBackupLike } from "./types";

export interface Plan<Item> {
  ready: Item[];
  skipped: { item: Item; reason: string }[];
}

/** Splits a selection into what an action applies to and what it would refuse, with why. */
export function planFor<Item>(
  items: Item[],
  refuse: (item: Item) => string | undefined,
): Plan<Item> {
  const plan: Plan<Item> = { ready: [], skipped: [] };

  for (const item of items) {
    const reason = refuse(item);

    if (reason) plan.skipped.push({ item, reason });
    else plan.ready.push(item);
  }

  return plan;
}

export type ClusterBulk = "backup" | "reload" | "hibernate" | "wake" | "restart";

export function clusterRefusal(action: ClusterBulk) {
  return (cluster: ClusterLike) => refusal(cluster, action);
}

export function scheduleRefusal(action: "backup" | "suspend" | "start", clusters: ClusterLike[]) {
  return (schedule: ScheduledBackupLike) => {
    if (action === "backup") return scheduleBackupRefusal(schedule, clusters);
    if (action === "suspend" && schedule.spec.suspend) return "Already suspended.";
    if (action === "start" && !schedule.spec.suspend) return "Already running.";

    return undefined;
  };
}

export function poolerRefusal(action: "pause" | "start") {
  return (pooler: PoolerLike) => {
    const paused = pooler.spec.pgbouncer?.paused === true;

    if (action === "pause" && paused) return "Already paused.";
    if (action === "start" && !paused) return "Already running.";

    return undefined;
  };
}

export function describeOutcome(verb: string, done: number, failed: string[]): string {
  const what = `${verb} ${done} of ${done + failed.length}.`;

  return failed.length === 0 ? what : `${what} Failed: ${failed.join(", ")}.`;
}
