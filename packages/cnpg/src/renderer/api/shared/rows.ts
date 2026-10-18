import { backupsNewestFirst, backupTime, belongsTo } from "../backups/backups";
import { clusterHealth } from "../clusters/clusters";
import type { BackupLike, ClusterLike, PodLike, PoolerLike, ScheduledBackupLike } from "./types";
import { ago, until, type Verdict } from "./verdict";

export const SCHEDULE_LABEL = "cnpg.io/scheduled-backup";
export const POOLER_LABEL = "cnpg.io/poolerName";

type Owned = { getNs(): string | undefined; getName(): string };

const namespacedKey = (namespace: string | undefined, name: string) => `${namespace}/${name}`;

function push<T>(groups: Map<string, T[]>, key: string, item: T) {
  const group = groups.get(key);

  if (group) group.push(item);
  else groups.set(key, [item]);
}

/** Backups and schedules grouped once, rather than scanned again for every cluster and schedule. */
export interface InventoryIndex {
  /** Newest first. */
  backupsOf(cluster: Owned): BackupLike[];
  schedulesOf(cluster: Owned): ScheduledBackupLike[];
  /** The newest Backup the schedule started. */
  lastRunOf(schedule: Owned): BackupLike | undefined;
}

export function indexInventory(inventory: {
  backups: BackupLike[];
  schedules: ScheduledBackupLike[];
}): InventoryIndex {
  const byCluster = new Map<string, BackupLike[]>();
  const bySchedule = new Map<string, BackupLike>();
  const schedules = new Map<string, ScheduledBackupLike[]>();

  for (const backup of backupsNewestFirst(inventory.backups)) {
    const cluster = namespacedKey(backup.getNs(), backup.spec.cluster.name);
    const schedule = backup.metadata.labels?.[SCHEDULE_LABEL];

    push(byCluster, cluster, backup);
    if (schedule && !bySchedule.has(namespacedKey(backup.getNs(), schedule))) {
      bySchedule.set(namespacedKey(backup.getNs(), schedule), backup);
    }
  }

  for (const schedule of inventory.schedules) {
    push(schedules, namespacedKey(schedule.getNs(), schedule.spec.cluster.name), schedule);
  }

  return {
    backupsOf: (cluster) => byCluster.get(namespacedKey(cluster.getNs(), cluster.getName())) ?? [],
    schedulesOf: (cluster) =>
      schedules.get(namespacedKey(cluster.getNs(), cluster.getName())) ?? [],
    lastRunOf: (schedule) => bySchedule.get(namespacedKey(schedule.getNs(), schedule.getName())),
  };
}

export function clusterNamed(clusters: ClusterLike[], namespace: string | undefined, name: string) {
  return clusters.find((cluster) => cluster.getNs() === namespace && cluster.getName() === name);
}

export function backupVerdict(backup: BackupLike): Verdict {
  const phase = backup.status?.phase;

  if (phase === "completed") return { tone: "ok", label: "Completed", reason: "Completed." };
  if (phase === "failed") {
    return { tone: "critical", label: "Failed", reason: backup.status?.error ?? "Failed." };
  }
  if (phase === "walArchivingFailing") {
    return { tone: "critical", label: "Archiving failing", reason: backup.status?.error ?? "" };
  }

  const label = phase ? `${phase.charAt(0).toUpperCase()}${phase.slice(1)}` : "Pending";

  return { tone: "info", label, reason: "In progress." };
}

export function backupDuration(backup: BackupLike): string | undefined {
  const start = backup.status?.startedAt ?? backup.status?.reconciliationStartedAt;
  const stop = backup.status?.stoppedAt ?? backup.status?.reconciliationTerminatedAt;

  if (!start || !stop) return undefined;

  const seconds = Math.round((Date.parse(stop) - Date.parse(start)) / 1000);

  return seconds < 120 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

export function scheduleVerdict(
  schedule: ScheduledBackupLike,
  clusters: ClusterLike[],
  index: Pick<InventoryIndex, "lastRunOf">,
  now: number,
): Verdict {
  if (!clusterNamed(clusters, schedule.getNs(), schedule.spec.cluster.name)) {
    return {
      tone: "critical",
      label: "Cluster missing",
      reason: `No cluster named ${schedule.spec.cluster.name} in ${schedule.getNs()}.`,
    };
  }

  if (schedule.spec.suspend) {
    return {
      tone: "warning",
      label: "Suspended",
      reason: "It starts no backup until started again.",
    };
  }

  const last = index.lastRunOf(schedule);

  if (last?.status?.phase === "failed") {
    return {
      tone: "critical",
      label: "Last run failed",
      reason: `The backup it started ${ago(backupTime(last), now)} failed${last.status?.error ? `: ${last.status.error}` : ""}.`,
    };
  }

  return {
    tone: "ok",
    label: "Active",
    reason: schedule.status?.nextScheduleTime
      ? `Next run ${until(schedule.status.nextScheduleTime, now)}.`
      : "Waiting for its first run.",
  };
}

export function isReady(pod: PodLike | undefined): boolean {
  return (
    pod?.status?.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    ) === true
  );
}

export interface PoolerReady {
  ready: number;
  wanted: number;
}

/** Undefined while the pods are not read: then nothing is said of them. */
export function poolerReady(
  pooler: PoolerLike,
  pods: PodLike[] | undefined,
): PoolerReady | undefined {
  if (!pods) return undefined;

  const ready = pods.filter(
    (pod) =>
      pod.getNs() === pooler.getNs() &&
      pod.metadata.labels?.[POOLER_LABEL] === pooler.getName() &&
      isReady(pod),
  ).length;

  return { ready, wanted: pooler.spec.instances ?? 1 };
}

export function poolerVerdict(
  pooler: PoolerLike,
  clusters: ClusterLike[],
  pods?: PodLike[],
): Verdict {
  const cluster = clusterNamed(clusters, pooler.getNs(), pooler.spec.cluster.name);

  if (!cluster) {
    return {
      tone: "critical",
      label: "Cluster missing",
      reason: pooler.status?.phaseReason ?? `No cluster named ${pooler.spec.cluster.name}.`,
    };
  }

  if (pooler.status?.phase && pooler.status.phase !== "active") {
    return {
      tone: "critical",
      label: "Inactive",
      reason: pooler.status.phaseReason ?? "The operator reports it inactive.",
    };
  }

  const running = poolerReady(pooler, pods);

  if (running && running.wanted > 0 && running.ready === 0) {
    return {
      tone: "critical",
      label: "No ready pod",
      reason: `${running.wanted === 1 ? "Its PgBouncer pod is not" : `None of its ${running.wanted} PgBouncer pods is`} ready, so nothing reaches ${cluster.getName()} through it.`,
    };
  }

  if (pooler.spec.pgbouncer?.paused) {
    return {
      tone: "warning",
      label: "Paused",
      reason: "PgBouncer holds new queries until started again.",
    };
  }

  const health = clusterHealth(cluster);

  if (health.tone === "critical" || health.tone === "info") {
    return {
      tone: "warning",
      label: "Cluster unavailable",
      reason: `Its cluster is ${health.label.toLowerCase()}.`,
    };
  }

  if (running && running.ready < running.wanted) {
    return {
      tone: "warning",
      label: "Degraded",
      reason: `${running.ready} of its ${running.wanted} PgBouncer pods are ready.`,
    };
  }

  return { tone: "ok", label: "Active", reason: `Serves ${cluster.getName()}.` };
}

export function poolersOf(cluster: ClusterLike, poolers: PoolerLike[]) {
  return poolers.filter((pooler) => belongsTo(pooler, cluster));
}

/** As the host's Ready column: ready of wanted, or a dash while the pods are not read. */
export function describePoolerReady(ready: PoolerReady | undefined): string {
  return ready ? `${ready.ready}/${ready.wanted}` : "—";
}
