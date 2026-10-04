import { conditionOf, isHibernated, type Tone, type Verdict } from "./clusters";
import type {
  BackupLike,
  BackupMethod,
  ClusterLike,
  ObjectStoreLike,
  ScheduledBackupLike,
} from "./types";

export const BARMAN_PLUGIN = "barman-cloud.cloudnative-pg.io";

/** A daily backup that has not run for this long has missed a day. */
export const STALE_AFTER_MS = 25 * 60 * 60 * 1000;

export interface BackupConfig {
  method?: BackupMethod;
  plugin?: string;
  /** The ObjectStore the plugin archives to. */
  objectStore?: string;
  archivesWal: boolean;
}

export function backupConfig(cluster: ClusterLike): BackupConfig {
  const archiver = cluster.spec.plugins?.find(
    (plugin) => plugin.enabled !== false && plugin.isWALArchiver,
  );

  if (archiver) {
    return {
      method: "plugin",
      plugin: archiver.name,
      objectStore:
        archiver.name === BARMAN_PLUGIN ? archiver.parameters?.barmanObjectName : undefined,
      archivesWal: true,
    };
  }

  if (cluster.spec.backup?.barmanObjectStore) {
    return { method: "barmanObjectStore", archivesWal: true };
  }

  if (cluster.spec.backup?.volumeSnapshot) return { method: "volumeSnapshot", archivesWal: false };

  return { archivesWal: false };
}

export function belongsTo(
  object: { getNs(): string | undefined; spec: { cluster: { name: string } } },
  cluster: ClusterLike,
): boolean {
  return object.getNs() === cluster.getNs() && object.spec.cluster.name === cluster.getName();
}

function latest(...times: (string | undefined)[]): string | undefined {
  return times
    .filter((time): time is string => Boolean(time))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

export function backupTime(backup: BackupLike): string {
  return (
    backup.status?.stoppedAt ??
    backup.status?.reconciliationTerminatedAt ??
    backup.status?.startedAt ??
    backup.metadata.creationTimestamp ??
    ""
  );
}

export function backupsNewestFirst(backups: BackupLike[]): BackupLike[] {
  return [...backups].sort((a, b) => Date.parse(backupTime(b)) - Date.parse(backupTime(a)));
}

export interface BackupFacts {
  config: BackupConfig;
  lastSuccess?: string;
  lastFailure?: string;
  lastError?: string;
  recoverableFrom?: string;
  archiving?: "working" | "failing";
  archivingMessage?: string;
  schedules: number;
  activeSchedules: number;
}

export function backupFacts(
  cluster: ClusterLike,
  backups: BackupLike[],
  schedules: ScheduledBackupLike[],
  objectStores: ObjectStoreLike[],
): BackupFacts {
  const config = backupConfig(cluster);
  const own = backups.filter((backup) => belongsTo(backup, cluster));
  const ownSchedules = schedules.filter((schedule) => belongsTo(schedule, cluster));
  const store = objectStores.find(
    (each) => each.getNs() === cluster.getNs() && each.getName() === config.objectStore,
  );
  const window = store?.status?.serverRecoveryWindow?.[cluster.getName()];
  const [failed] = backupsNewestFirst(own.filter((backup) => backup.status?.phase === "failed"));
  const archiving = conditionOf(cluster, "ContinuousArchiving");

  return {
    config,
    lastSuccess: latest(
      window?.lastSuccessfulBackupTime,
      cluster.status?.lastSuccessfulBackup,
      ...own.filter((backup) => backup.status?.phase === "completed").map(backupTime),
    ),
    lastFailure: latest(
      window?.lastFailedBackupTime,
      cluster.status?.lastFailedBackup,
      failed ? backupTime(failed) : undefined,
    ),
    lastError: failed?.status?.error,
    recoverableFrom: window?.firstRecoverabilityPoint ?? cluster.status?.firstRecoverabilityPoint,
    // Without an archiver the condition still reads "working"; it means nothing then.
    archiving: config.archivesWal
      ? archiving?.status === "False"
        ? "failing"
        : archiving?.status === "True"
          ? "working"
          : undefined
      : undefined,
    archivingMessage: archiving?.status === "False" ? archiving.message : undefined,
    schedules: ownSchedules.length,
    activeSchedules: ownSchedules.filter((schedule) => !schedule.spec.suspend).length,
  };
}

export function formatAge(ms: number): string {
  if (ms < 60_000) return "just now";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

export function ago(time: string | undefined, now: number): string {
  if (!time) return "—";

  const at = Date.parse(time);

  if (Number.isNaN(at)) return "—";

  const age = formatAge(Math.max(0, now - at));

  return age === "just now" ? age : `${age} ago`;
}

export function backupHealth(facts: BackupFacts, cluster: ClusterLike, now: number): Verdict {
  const { config } = facts;

  if (!config.method && !facts.lastSuccess) {
    return {
      tone: "critical",
      label: "No backup",
      reason: "No backup method is configured and no backup has completed. It cannot be restored.",
    };
  }

  if (facts.archiving === "failing" && !isHibernated(cluster)) {
    return {
      tone: "critical",
      label: "Archiving failing",
      reason:
        `WAL is not reaching the object store, so the recovery window stops growing. ${facts.archivingMessage ?? ""}`.trim(),
    };
  }

  const failedLast =
    facts.lastFailure &&
    (!facts.lastSuccess || Date.parse(facts.lastFailure) > Date.parse(facts.lastSuccess));

  if (failedLast) {
    return {
      tone: "critical",
      label: "Last backup failed",
      reason: `Failed ${ago(facts.lastFailure, now)}${facts.lastError ? `: ${facts.lastError}` : ""}.`,
    };
  }

  if (!facts.lastSuccess) {
    return {
      tone: "warning",
      label: "No backup yet",
      reason: "A method is configured, but no backup has completed.",
    };
  }

  const tone: Tone = "ok";
  const since = facts.recoverableFrom ? `, recoverable since ${facts.recoverableFrom}` : "";

  if (now - Date.parse(facts.lastSuccess) > STALE_AFTER_MS) {
    return {
      tone: "warning",
      label: "Backup is old",
      reason: `The last backup completed ${ago(facts.lastSuccess, now)}${since}.`,
    };
  }

  if (facts.activeSchedules === 0) {
    return {
      tone: "warning",
      label: "No schedule",
      reason: `The last backup completed ${ago(facts.lastSuccess, now)}, and nothing schedules the next.`,
    };
  }

  return {
    tone,
    label: "Backed up",
    reason: `Last backup ${ago(facts.lastSuccess, now)}${since}.`,
  };
}
