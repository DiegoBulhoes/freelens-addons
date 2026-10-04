import { backupFacts, backupHealth } from "./backups";
import { declaredIssues } from "./cluster-status";
import { clusterHealth, isHibernated, RANK, type Verdict, worse } from "./clusters";
import { logicalRows } from "./logical";
import { replicaLags } from "./replication";
import { poolerVerdict, scheduleVerdict } from "./rows";
import type {
  BackupLike,
  ClusterLike,
  InstanceStatus,
  ObjectStoreLike,
  PoolerLike,
  PublicationLike,
  ScheduledBackupLike,
  SubscriptionLike,
} from "./types";
import { upkeepIssues } from "./upkeep";

export interface Inventory {
  clusters: ClusterLike[];
  backups: BackupLike[];
  schedules: ScheduledBackupLike[];
  poolers: PoolerLike[];
  objectStores: ObjectStoreLike[];
  publications?: PublicationLike[];
  subscriptions?: SubscriptionLike[];
  /** /pg/status of instances, by "namespace/pod"; read live, so absent until fetched. */
  statuses?: Record<string, InstanceStatus | undefined>;
}

export function lagIssues(cluster: ClusterLike, statuses: Inventory["statuses"]): Verdict[] {
  const namespace = cluster.getNs();
  const primary = statuses?.[`${namespace}/${cluster.status?.currentPrimary}`];
  const replicas = Object.fromEntries(
    (cluster.status?.instanceNames ?? []).map((name) => [name, statuses?.[`${namespace}/${name}`]]),
  );

  return replicaLags(primary, replicas)
    .filter((lag) => lag.verdict.tone !== "ok")
    .map((lag) => ({ ...lag.verdict, reason: `${lag.replica}: ${lag.verdict.reason}` }));
}

export interface ClusterRow {
  cluster: ClusterLike;
  health: Verdict;
  backup: Verdict;
  lastBackup?: string;
  recoverableFrom?: string;
}

export interface AttentionItem {
  kind: "Cluster" | "Pooler" | "ScheduledBackup" | "Publication" | "Subscription";
  name: string;
  namespace?: string;
  cluster: string;
  verdict: Verdict;
}

export interface Counts {
  clusters: number;
  notReady: number;
  backupsAtRisk: number;
  noBackup: number;
  hibernated: number;
  poolersDown: number;
}

export function clusterRows(inventory: Inventory, now: number): ClusterRow[] {
  return inventory.clusters
    .map((cluster) => {
      const facts = backupFacts(
        cluster,
        inventory.backups,
        inventory.schedules,
        inventory.objectStores,
      );

      return {
        cluster,
        health: clusterHealth(cluster),
        backup: backupHealth(facts, cluster, now),
        lastBackup: facts.lastSuccess,
        recoverableFrom: facts.recoverableFrom,
      };
    })
    .sort(
      (a, b) =>
        RANK[worse(a.health, a.backup).tone] - RANK[worse(b.health, b.backup).tone] ||
        a.cluster.getName().localeCompare(b.cluster.getName()),
    );
}

/** Worst first. A hibernated cluster is a choice, not a fault, so it is listed only for its backups. */
export function attentionItems(inventory: Inventory, now: number): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const row of clusterRows(inventory, now)) {
    const verdict = worse(row.health.tone === "info" ? row.backup : row.health, row.backup);

    if (verdict.tone === "critical" || verdict.tone === "warning") {
      items.push({
        kind: "Cluster",
        name: row.cluster.getName(),
        namespace: row.cluster.getNs(),
        cluster: row.cluster.getName(),
        verdict,
      });
    }

    for (const issue of [
      ...upkeepIssues(row.cluster, now),
      ...declaredIssues(row.cluster),
      ...lagIssues(row.cluster, inventory.statuses),
    ]) {
      items.push({
        kind: "Cluster",
        name: row.cluster.getName(),
        namespace: row.cluster.getNs(),
        cluster: row.cluster.getName(),
        verdict: issue,
      });
    }
  }

  for (const pooler of inventory.poolers) {
    const verdict = poolerVerdict(pooler, inventory.clusters);

    if (verdict.tone === "critical") {
      items.push({
        kind: "Pooler",
        name: pooler.getName(),
        namespace: pooler.getNs(),
        cluster: pooler.spec.cluster.name,
        verdict,
      });
    }
  }

  for (const schedule of inventory.schedules) {
    const verdict = scheduleVerdict(schedule, inventory.clusters, inventory.backups, now);

    if (verdict.tone === "critical") {
      items.push({
        kind: "ScheduledBackup",
        name: schedule.getName(),
        namespace: schedule.getNs(),
        cluster: schedule.spec.cluster.name,
        verdict,
      });
    }
  }

  for (const row of logicalRows(inventory.publications ?? [], inventory.subscriptions ?? [])) {
    if (row.verdict.tone === "critical") {
      items.push({
        kind: row.kind,
        name: row.object.getName(),
        namespace: row.object.getNs(),
        cluster: row.cluster,
        verdict: row.verdict,
      });
    }
  }

  return items.sort((a, b) => RANK[a.verdict.tone] - RANK[b.verdict.tone]);
}

export function countsOf(inventory: Inventory, now: number): Counts {
  const rows = clusterRows(inventory, now);

  return {
    clusters: rows.length,
    notReady: rows.filter((row) => row.health.tone === "critical").length,
    backupsAtRisk: rows.filter((row) => row.backup.tone === "critical").length,
    noBackup: rows.filter((row) => row.backup.label === "No backup").length,
    hibernated: inventory.clusters.filter(isHibernated).length,
    poolersDown: inventory.poolers.filter(
      (pooler) => poolerVerdict(pooler, inventory.clusters).tone === "critical",
    ).length,
  };
}

export function describeHeadline(needingAttention: number, total: number): string {
  if (total === 0) return "No Postgres clusters found";
  if (needingAttention === 0) {
    return `All ${total} Postgres cluster${total === 1 ? " is" : "s are"} ready and backed up`;
  }

  return `${needingAttention} of ${total} Postgres clusters need attention`;
}
