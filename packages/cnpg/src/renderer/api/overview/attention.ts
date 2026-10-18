import { backupFacts, backupHealth } from "../backups/backups";
import { declaredIssues } from "../clusters/cluster-status";
import { clusterHealth } from "../clusters/clusters";
import { upkeepIssues } from "../clusters/upkeep";
import { logicalRows } from "../replication/logical";
import { clusterLags } from "../replication/replication";
import {
  CLUSTER_FILTER_TITLES,
  type ClusterFilter,
  matchesClusterFilter,
  matchesPoolerFilter,
  type OpenPage,
  opensTitle,
  POOLER_FILTER_TITLES,
} from "../shared/navigation";
import {
  type InventoryIndex,
  indexInventory,
  poolerVerdict,
  scheduleVerdict,
} from "../shared/rows";
import type { LoadState } from "../shared/store-state";
import type {
  BackupLike,
  ClusterLike,
  InstanceStatus,
  ObjectStoreLike,
  PodLike,
  PoolerLike,
  PublicationLike,
  ScheduledBackupLike,
  SubscriptionLike,
} from "../shared/types";
import { RANK, type Tone, type Verdict, worse } from "../shared/verdict";

export interface Inventory {
  clusters: ClusterLike[];
  backups: BackupLike[];
  schedules: ScheduledBackupLike[];
  poolers: PoolerLike[];
  objectStores: ObjectStoreLike[];
  publications?: PublicationLike[];
  subscriptions?: SubscriptionLike[];
  /** Undefined until read: a pooler is then judged without its pods. */
  pods?: PodLike[];
  /** /pg/status of instances, by "namespace/pod"; read live, so absent until fetched. */
  statuses?: Record<string, InstanceStatus | undefined>;
}

export function lagIssues(cluster: ClusterLike, statuses: Inventory["statuses"]): Verdict[] {
  return clusterLags(cluster, statuses)
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

export function clusterRows(
  inventory: Inventory,
  now: number,
  index: InventoryIndex = indexInventory(inventory),
): ClusterRow[] {
  return inventory.clusters
    .map((cluster) => {
      const facts = backupFacts(
        cluster,
        index.backupsOf(cluster),
        index.schedulesOf(cluster),
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

function clusterItem(row: ClusterRow, verdict: Verdict): AttentionItem {
  return {
    kind: "Cluster",
    name: row.cluster.getName(),
    namespace: row.cluster.getNs(),
    cluster: row.cluster.getName(),
    verdict,
  };
}

function clusterAttention(
  rows: ClusterRow[],
  statuses: Inventory["statuses"],
  now: number,
): AttentionItem[] {
  return rows.flatMap((row) => {
    const verdict = worse(row.health.tone === "info" ? row.backup : row.health, row.backup);
    const issues = [
      ...upkeepIssues(row.cluster, now),
      ...declaredIssues(row.cluster),
      ...lagIssues(row.cluster, statuses),
    ];

    return [
      ...(verdict.tone === "critical" || verdict.tone === "warning"
        ? [clusterItem(row, verdict)]
        : []),
      ...issues.map((issue) => clusterItem(row, issue)),
    ];
  });
}

function poolerAttention(inventory: Inventory): AttentionItem[] {
  return inventory.poolers.flatMap((pooler): AttentionItem[] => {
    const verdict = poolerVerdict(pooler, inventory.clusters, inventory.pods);

    return verdict.tone === "critical"
      ? [
          {
            kind: "Pooler",
            name: pooler.getName(),
            namespace: pooler.getNs(),
            cluster: pooler.spec.cluster.name,
            verdict,
          },
        ]
      : [];
  });
}

function scheduleAttention(
  inventory: Inventory,
  index: InventoryIndex,
  now: number,
): AttentionItem[] {
  return inventory.schedules.flatMap((schedule): AttentionItem[] => {
    const verdict = scheduleVerdict(schedule, inventory.clusters, index, now);

    return verdict.tone === "critical"
      ? [
          {
            kind: "ScheduledBackup",
            name: schedule.getName(),
            namespace: schedule.getNs(),
            cluster: schedule.spec.cluster.name,
            verdict,
          },
        ]
      : [];
  });
}

function logicalAttention(inventory: Inventory): AttentionItem[] {
  return logicalRows(inventory.publications ?? [], inventory.subscriptions ?? []).flatMap(
    (row): AttentionItem[] =>
      row.verdict.tone === "critical"
        ? [
            {
              kind: row.kind,
              name: row.object.getName(),
              namespace: row.object.getNs(),
              cluster: row.cluster,
              verdict: row.verdict,
            },
          ]
        : [],
  );
}

/** Worst first. A hibernated cluster is a choice, not a fault, so it is listed only for its backups. */
export function attentionItems(
  inventory: Inventory,
  now: number,
  index: InventoryIndex = indexInventory(inventory),
  rows: ClusterRow[] = clusterRows(inventory, now, index),
): AttentionItem[] {
  return [
    ...clusterAttention(rows, inventory.statuses, now),
    ...poolerAttention(inventory),
    ...scheduleAttention(inventory, index, now),
    ...logicalAttention(inventory),
  ].sort((a, b) => RANK[a.verdict.tone] - RANK[b.verdict.tone]);
}

/** Each count is the rows the list filter it opens keeps. */
export function countsOf(
  inventory: Inventory,
  now: number,
  rows: ClusterRow[] = clusterRows(inventory, now),
): Counts {
  const count = (filter: ClusterFilter) =>
    rows.filter((row) => matchesClusterFilter(row, filter)).length;

  return {
    clusters: rows.length,
    notReady: count("not-ready"),
    backupsAtRisk: count("at-risk"),
    noBackup: count("no-backup"),
    hibernated: count("hibernated"),
    poolersDown: inventory.poolers.filter((pooler) =>
      matchesPoolerFilter(poolerVerdict(pooler, inventory.clusters, inventory.pods), "down"),
    ).length,
  };
}

export interface Card {
  label: string;
  value: number;
  tone?: Tone;
  title: string;
  opens: Parameters<OpenPage>;
}

/** None before the lists are read: a zero there would claim what no list has said. */
export function cardsOf(counts: Counts, state: LoadState): Card[] {
  if (state !== "ready") return [];

  const clusterCard = (label: string, value: number, filter: ClusterFilter, tone: Tone): Card => ({
    label,
    value,
    tone,
    title: opensTitle(CLUSTER_FILTER_TITLES[filter]),
    opens: ["clusters", { filter }],
  });

  return [
    {
      label: "Clusters",
      value: counts.clusters,
      title: "Opens every cluster",
      opens: ["clusters"],
    },
    clusterCard("Not ready", counts.notReady, "not-ready", "critical"),
    clusterCard("Cannot be restored safely", counts.backupsAtRisk, "at-risk", "critical"),
    clusterCard("No backup", counts.noBackup, "no-backup", "critical"),
    clusterCard("Hibernated", counts.hibernated, "hibernated", "info"),
    {
      label: "Poolers down",
      value: counts.poolersDown,
      tone: "critical",
      title: opensTitle(POOLER_FILTER_TITLES.down),
      opens: ["poolers", { filter: "down" }],
    },
  ];
}

/** An attention row opens its own object's drawer, by namespace and name. */
export function destinationOf(item: AttentionItem): { title: string; opens: Parameters<OpenPage> } {
  const named = { namespace: item.namespace, name: item.name };

  switch (item.kind) {
    case "Cluster":
      return { title: "Opens the cluster", opens: ["clusters", named] };
    case "Pooler":
      return { title: "Opens the pooler", opens: ["poolers", named] };
    case "ScheduledBackup":
      return { title: "Opens the schedule", opens: ["schedules", named] };
    default:
      return {
        title: `Opens the ${item.kind.toLowerCase()}`,
        opens: ["logical", { ...named, kind: item.kind }],
      };
  }
}

/** Two clusters of one name in two namespaces are two clusters. */
export function clustersNeeding(items: AttentionItem[]): number {
  return new Set(
    items.filter((item) => item.kind === "Cluster").map((item) => `${item.namespace}/${item.name}`),
  ).size;
}

/** Unique per row: one cluster can have two issues of one label, as two replicas not streaming. */
export function attentionKey(item: AttentionItem): string {
  return `${item.kind}/${item.namespace}/${item.name}/${item.verdict.label}/${item.verdict.reason}`;
}

export function describeHeadline(
  needingAttention: number,
  total: number,
  state: LoadState,
): string {
  // No rows before the lists are read is not yet no clusters.
  if (total === 0) return state === "ready" ? "No Postgres clusters found" : "Postgres clusters";
  if (needingAttention === 0) {
    return `All ${total} Postgres cluster${total === 1 ? " is" : "s are"} ready and backed up`;
  }

  return `${needingAttention} of ${total} Postgres clusters need attention`;
}
