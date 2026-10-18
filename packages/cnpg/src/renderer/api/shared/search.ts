import { replicaSourceOf } from "../clusters/clusters";
import type { ClusterRow } from "../overview/attention";
import type { LogicalRow } from "../replication/logical";
import { backupVerdict } from "./rows";
import type { BackupLike, PoolerLike, ScheduledBackupLike } from "./types";
import type { Verdict } from "./verdict";

// What each list's search box reads; the namespace too, as the Clusters list and the host's lists do.

export const clusterSearchTexts = (row: ClusterRow) => {
  const source = replicaSourceOf(row.cluster);

  return [
    row.cluster.getName(),
    row.cluster.getNs() ?? "",
    row.health.label,
    row.backup.label,
    ...(source ? [`replica of ${source.name}`] : []),
  ];
};

export const backupSearchTexts = (backup: BackupLike) => [
  backup.getName(),
  backup.getNs() ?? "",
  backup.spec.cluster.name,
  backupVerdict(backup).label,
];

export const scheduleSearchTexts = (schedule: ScheduledBackupLike, verdict: Verdict) => [
  schedule.getName(),
  schedule.getNs() ?? "",
  schedule.spec.cluster.name,
  verdict.label,
];

export const poolerSearchTexts = (pooler: PoolerLike, verdict: Verdict) => [
  pooler.getName(),
  pooler.getNs() ?? "",
  pooler.spec.cluster.name,
  verdict.label,
];

export const logicalSearchTexts = (row: LogicalRow) => [
  row.object.getName(),
  row.object.getNs() ?? "",
  row.kind,
  row.cluster,
  row.database,
  row.name,
  row.verdict.label,
];
