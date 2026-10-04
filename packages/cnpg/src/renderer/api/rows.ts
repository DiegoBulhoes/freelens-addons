import { ago, backupsNewestFirst, backupTime, belongsTo } from "./backups";
import { clusterHealth, type Verdict } from "./clusters";
import type { BackupLike, ClusterLike, PoolerLike, ScheduledBackupLike } from "./types";

export const SCHEDULE_LABEL = "cnpg.io/scheduled-backup";

function clusterNamed(clusters: ClusterLike[], namespace: string | undefined, name: string) {
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
  backups: BackupLike[],
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

  const last = backupsNewestFirst(
    backups.filter(
      (backup) =>
        backup.getNs() === schedule.getNs() &&
        backup.metadata.labels?.[SCHEDULE_LABEL] === schedule.getName(),
    ),
  )[0];

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
      ? `Next run ${schedule.status.nextScheduleTime}.`
      : "Waiting for its first run.",
  };
}

export function poolerVerdict(pooler: PoolerLike, clusters: ClusterLike[]): Verdict {
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

  return { tone: "ok", label: "Active", reason: `Serves ${cluster.getName()}.` };
}

export function schedulesOf(cluster: ClusterLike, schedules: ScheduledBackupLike[]) {
  return schedules.filter((schedule) => belongsTo(schedule, cluster));
}

export function poolersOf(cluster: ClusterLike, poolers: PoolerLike[]) {
  return poolers.filter((pooler) => belongsTo(pooler, cluster));
}

export function backupsOf(cluster: ClusterLike, backups: BackupLike[]) {
  return backupsNewestFirst(backups.filter((backup) => belongsTo(backup, cluster)));
}
