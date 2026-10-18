import type { InventoryIndex } from "../shared/rows";
import type { BackupLike, ClusterLike } from "../shared/types";
import { backupConfig } from "./backups";

export const PLUGIN_CONTAINER = "plugin-barman-cloud";

export interface LogSource {
  pod: string;
  container: string;
}

function barmanContainer(method: string | undefined): string {
  return method === "plugin" ? PLUGIN_CONTAINER : "postgres";
}

/** Where barman archives WAL: the primary's plugin sidecar, or postgres for the in-tree method. */
export function archivingLogSource(cluster: ClusterLike): LogSource | undefined {
  const config = backupConfig(cluster);
  const pod = cluster.status?.currentPrimary;

  if (!pod || !config.archivesWal) return undefined;

  return { pod, container: barmanContainer(config.method) };
}

/** Where barman wrote while taking this backup: the instance that ran it, standby or primary. */
export function backupLogSource(cluster: ClusterLike, backup: BackupLike): LogSource | undefined {
  const method = backup.spec.method ?? "barmanObjectStore";
  const pod = backup.status?.instanceID?.podName ?? cluster.status?.currentPrimary;

  if (!pod || (method !== "plugin" && method !== "barmanObjectStore")) return undefined;

  return { pod, container: barmanContainer(method) };
}

export function logSourceKey(namespace: string | undefined, source: LogSource): string {
  return `${namespace}/${source.pod}/${source.container}`;
}

/** Only these send us to the log: the others say why already. */
export function wantsCause(label: string): boolean {
  return (
    label === "Archiving failing" || label === "Last backup failed" || label === "Last run failed"
  );
}

/** Archiving fails in the primary's log; a failed backup in the log of the instance that took it. */
export function causeSourceOf(
  cluster: ClusterLike,
  label: string,
  failed: BackupLike | undefined,
): LogSource | undefined {
  if (label === "Archiving failing") return archivingLogSource(cluster);
  if (!wantsCause(label) || !failed) return undefined;

  return backupLogSource(cluster, failed);
}

/** The Backup a failure verdict is about: a schedule's last run, or the cluster's newest failed one. */
export function failedBackupOf(
  item: { kind: string; namespace?: string; name: string; cluster: string },
  index: Pick<InventoryIndex, "backupsOf" | "lastRunOf">,
): BackupLike | undefined {
  const owner = (name: string) => ({ getNs: () => item.namespace, getName: () => name });

  if (item.kind === "ScheduledBackup") return index.lastRunOf(owner(item.name));

  return index.backupsOf(owner(item.cluster)).find((backup) => backup.status?.phase === "failed");
}

// The operator only records "exit status 1"; barman's own stderr line says why.
export function causeFromLog(log: string): string | undefined {
  let cause: string | undefined;

  for (const line of log.split("\n")) {
    let message: unknown;

    try {
      message = (JSON.parse(line) as { msg?: unknown }).msg;
    } catch {
      continue;
    }

    if (typeof message !== "string") continue;

    const at = message.indexOf("ERROR:");

    if (at >= 0) cause = message.slice(at + "ERROR:".length).trim();
  }

  return cause;
}
