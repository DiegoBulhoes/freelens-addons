import { keyOf } from "../shared/navigation";
import { clusterNamed, SCHEDULE_LABEL } from "../shared/rows";
import type { BackupLike, BackupMethod, ClusterLike, ScheduledBackupLike } from "../shared/types";
import { clusterActionRefusal, hibernatedRefusal } from "../writes/operations";
import { backupConfig } from "./backups";

export interface BackupManifest {
  apiVersion: "postgresql.cnpg.io/v1";
  kind: "Backup";
  metadata: { name: string; namespace: string; labels?: Record<string, string> };
  spec: {
    cluster: { name: string };
    method: string;
    pluginConfiguration?: { name: string; parameters?: Record<string, string> };
    target?: BackupTarget;
    online?: boolean;
    onlineConfiguration?: { immediateCheckpoint?: boolean; waitForArchive?: boolean };
  };
}

function stamp(now: number): string {
  return new Date(now).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

export type BackupTarget = "primary" | "prefer-standby";

export interface BackupOptions {
  method?: BackupMethod;
  target?: BackupTarget;
  /** Volume snapshots only: false stops Postgres on the instance for a cold copy. */
  online?: boolean;
  immediateCheckpoint?: boolean;
  /** The operator waits by default; false stops it waiting for the closing WAL. */
  waitForArchive?: boolean;
}

/** These three exist for volume snapshots; other methods are always online. */
export function snapshotSettings(options: BackupOptions) {
  if (options.method !== "volumeSnapshot") return {};

  const online = options.online !== false;
  const configuration = {
    ...(options.immediateCheckpoint ? { immediateCheckpoint: true } : {}),
    ...(options.waitForArchive === false ? { waitForArchive: false } : {}),
  };

  return {
    ...(online ? {} : { online: false }),
    ...(online && Object.keys(configuration).length > 0
      ? { onlineConfiguration: configuration }
      : {}),
  };
}

/** The cluster's own method first; volume snapshots too when it declares a snapshot class. */
export function backupMethods(cluster: ClusterLike): BackupMethod[] {
  const own = backupConfig(cluster).method;
  const methods: BackupMethod[] = own ? [own] : [];

  if (cluster.spec.backup?.volumeSnapshot && own !== "volumeSnapshot")
    methods.push("volumeSnapshot");

  return methods;
}

/** What `kubectl cnpg backup` creates; undefined when the cluster has no backup method. */
export function backupManifest(
  cluster: ClusterLike,
  now: number,
  options: BackupOptions = {},
): BackupManifest | undefined {
  const config = backupConfig(cluster);
  const method = options.method ?? config.method;

  if (!method || !backupMethods(cluster).includes(method)) return undefined;

  return {
    apiVersion: "postgresql.cnpg.io/v1",
    kind: "Backup",
    metadata: { name: `${cluster.getName()}-${stamp(now)}`, namespace: cluster.getNs() ?? "" },
    spec: {
      cluster: { name: cluster.getName() },
      method,
      ...(method === "plugin" && config.plugin
        ? { pluginConfiguration: { name: config.plugin } }
        : {}),
      ...(options.target ? { target: options.target } : {}),
      ...snapshotSettings({ ...options, method }),
    },
  };
}

/** What the operator starts from the schedule, labelled so the schedule reports it as its run. */
export function scheduleBackupManifest(schedule: ScheduledBackupLike, now: number): BackupManifest {
  const { cluster, method, target, online, onlineConfiguration, pluginConfiguration } =
    schedule.spec;

  return {
    apiVersion: "postgresql.cnpg.io/v1",
    kind: "Backup",
    metadata: {
      name: `${schedule.getName()}-${stamp(now)}`,
      namespace: schedule.getNs() ?? "",
      labels: { [SCHEDULE_LABEL]: schedule.getName() },
    },
    spec: {
      cluster: { name: cluster.name },
      method: method ?? "barmanObjectStore",
      ...(target ? { target } : {}),
      ...(online === undefined ? {} : { online }),
      ...(onlineConfiguration ? { onlineConfiguration: { ...onlineConfiguration } } : {}),
      ...(pluginConfiguration
        ? {
            pluginConfiguration: {
              name: pluginConfiguration.name,
              ...(pluginConfiguration.parameters
                ? { parameters: { ...pluginConfiguration.parameters } }
                : {}),
            },
          }
        : {}),
    },
  };
}

export function scheduleBackupRefusal(
  schedule: ScheduledBackupLike,
  clusters: ClusterLike[],
): string | undefined {
  const cluster = clusterNamed(clusters, schedule.getNs(), schedule.spec.cluster.name);

  if (!cluster)
    return `No cluster named ${schedule.spec.cluster.name}, so there is nothing to back up.`;

  return hibernatedRefusal(cluster);
}

/** Clusters a backup can be started for now. */
export function backupCandidates(clusters: ClusterLike[]): ClusterLike[] {
  return clusters.filter((cluster) => clusterActionRefusal(cluster, "backup") === undefined);
}

/** The Back up picker's manifest: the picked cluster, with every option its form set. */
export function pickedBackup(
  candidates: ClusterLike[],
  picked: string,
  options: BackupOptions,
  now: number,
): { cluster: ClusterLike; manifest: BackupManifest } | undefined {
  const cluster = candidates.find((each) => keyOf(each) === picked);
  const manifest = cluster ? backupManifest(cluster, now, options) : undefined;

  return cluster && manifest ? { cluster, manifest } : undefined;
}

/** Deleted with the schedule: Kubernetes collects what it owns. */
export function ownedBackups(schedule: ScheduledBackupLike, backups: BackupLike[]): BackupLike[] {
  return backups.filter(
    (backup) =>
      backup.getNs() === schedule.getNs() &&
      (backup.metadata.ownerReferences ?? []).some(
        (owner) => owner.kind === "ScheduledBackup" && owner.name === schedule.getName(),
      ),
  );
}
