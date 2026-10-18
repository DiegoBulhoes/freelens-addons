import { failedAmong, type LoadState } from "../shared/store-state";
import type { PodLike, PvcLike, RedisKind, RedisLike } from "../shared/types";
import { plural, RANK, type Verdict } from "../shared/verdict";
import { restartAllPlan, restartAllRefusal } from "../writes/operations";
import { healthOf, PODS_REFUSED, PODS_UNREAD } from "./health";
import { crdKindOf, kindOf, nodesOf, type RedisNode } from "./nodes";
import { type SecretListings, type TlsView, tlsOf } from "./upkeep";

export interface Inventory {
  objects: RedisLike[];
  pods: PodLike[];
  pvcs: PvcLike[];
  /** False while the pods and volumes are another scope's or not read yet. */
  podsRead: boolean;
  /** Namespaces whose pods or volumes were refused. */
  podsFailed?: ReadonlySet<string>;
  /** By namespace; a namespace not in it is not listed yet. */
  secrets?: SecretListings;
}

export interface RedisRow {
  object: RedisLike;
  kind: RedisKind;
  nodes: RedisNode[];
  health: Verdict;
  tls: TlsView;
  /** For a replication, its sentinels; for a sentinel, the replication it watches. */
  related: RedisLike[];
}

export const keyOf = (object: RedisLike) => `${object.kind}/${object.getNs()}/${object.getName()}`;

/** The key of the row a page's route params name, whose drawer opens; undefined without a name. */
export function namedKey(
  kind: RedisKind,
  named: { namespace?: string; name?: string },
): string | undefined {
  return named.name ? `${crdKindOf(kind)}/${named.namespace ?? ""}/${named.name}` : undefined;
}

const ofKind = (objects: RedisLike[], kind: RedisKind) =>
  objects.filter((each) => kindOf(each) === kind);

/** The sentinels watching a replication. */
export function sentinelsOf(replication: RedisLike, sentinels: RedisLike[]): RedisLike[] {
  return sentinels.filter(
    (each) =>
      each.getNs() === replication.getNs() &&
      each.spec.redisSentinelConfig?.redisReplicationName === replication.getName(),
  );
}

function relatedOf(object: RedisLike, objects: RedisLike[]): RedisLike[] {
  if (kindOf(object) === "Replication") return sentinelsOf(object, ofKind(objects, "Sentinel"));
  if (kindOf(object) !== "Sentinel") return [];

  const watched = object.spec.redisSentinelConfig?.redisReplicationName;

  return ofKind(objects, "Replication").filter(
    (each) => each.getNs() === object.getNs() && each.getName() === watched,
  );
}

function unjudgedVerdict(inventory: Inventory, object: RedisLike): Verdict | undefined {
  if (!inventory.podsRead) return PODS_UNREAD;
  if (inventory.podsFailed && failedAmong(inventory.podsFailed, [object.getNs() ?? ""])) {
    return PODS_REFUSED;
  }

  return undefined;
}

/** Worst first, then by name. */
export function redisRows(inventory: Inventory, now = Date.now()): RedisRow[] {
  return inventory.objects
    .map((object) => {
      const nodes = nodesOf(object, inventory.pods, inventory.pvcs);
      const related = relatedOf(object, inventory.objects);
      const kind = kindOf(object);
      const context = kind === "Sentinel" ? { watchedExists: related.length > 0, now } : { now };

      return {
        object,
        kind,
        nodes,
        related,
        health: unjudgedVerdict(inventory, object) ?? healthOf(object, nodes, context),
        tls: tlsOf(object, inventory.secrets),
      };
    })
    .sort(
      (a, b) =>
        RANK[a.health.tone] - RANK[b.health.tone] ||
        a.object.getName().localeCompare(b.object.getName()),
    );
}

const isUnjudged = (row: RedisRow) => row.health === PODS_UNREAD || row.health === PODS_REFUSED;

/** Not a row whose pods are unread: it is not known to need anything. */
export function needsAttention(row: RedisRow): boolean {
  return !isUnjudged(row) && row.health.tone !== "ok";
}

/** A write judged on pods never read would give a false reason, such as "not ready". */
export function unreadRefusal(row: RedisRow): string | undefined {
  return isUnjudged(row) ? row.health.reason : undefined;
}

/** Why a ticked row is not restarted pod by pod, if it is not. */
export function bulkRestartRefusal(row: RedisRow): string | undefined {
  const plan = restartAllPlan(row.object, row.nodes);

  return unreadRefusal(row) ?? restartAllRefusal(plan);
}

export type RowFilter = "all" | "down" | "degraded" | "unwatched";

export const FILTER_LABELS: Record<RowFilter, string> = {
  all: "All",
  down: "Down or failed",
  degraded: "Degraded",
  unwatched: "No sentinel",
};

export const FILTER_TITLES: Record<RowFilter, string> = {
  all: "Shows every one",
  down: "Shows those that are down, failed, or refuse writes",
  degraded: "Shows those missing a pod, or stuck",
  unwatched: "Shows the replications no sentinel watches: nothing fails them over",
};

/** No sentinel is a replication's alone. */
export function filtersFor(kind: RedisKind): RowFilter[] {
  return kind === "Replication"
    ? ["all", "down", "degraded", "unwatched"]
    : ["all", "down", "degraded"];
}

export function filterOf(kind: RedisKind, param: string | undefined): RowFilter {
  return filtersFor(kind).find((each) => each === param) ?? "all";
}

export function matchesFilter(row: RedisRow, filter: RowFilter): boolean {
  switch (filter) {
    case "down":
      return row.health.tone === "critical";
    case "degraded":
      return row.health.tone === "warning";
    case "unwatched":
      return row.kind === "Replication" && row.related.length === 0;
    default:
      return true;
  }
}

/** The overview's Needs attention, narrowed by its chips. */
export function attentionOf(rows: RedisRow[], filter: RowFilter): RedisRow[] {
  return rows.filter((row) => needsAttention(row) && matchesFilter(row, filter));
}

/** A card counts the rows its filter keeps. */
export function countsOf(rows: RedisRow[]) {
  const of = (kind: RedisKind) => rows.filter((row) => row.kind === kind).length;
  const kept = (filter: RowFilter) => rows.filter((row) => matchesFilter(row, filter)).length;

  return {
    total: rows.length,
    down: kept("down"),
    degraded: kept("degraded"),
    replications: of("Replication"),
    clusters: of("Cluster"),
    standalones: of("Standalone"),
    sentinels: of("Sentinel"),
    unwatched: kept("unwatched"),
  };
}

/** None is a claim only a read list can make. */
export function describeHeadline(rows: RedisRow[], state: LoadState): string {
  const total = rows.length;
  const needing = rows.filter(needsAttention).length;
  const objects = plural(total, "Redis object");

  if (total === 0) return state === "ready" ? "No Redis" : "Redis";
  if (needing > 0) return `${needing} of ${objects} need${needing === 1 ? "s" : ""} attention`;
  if (rows.some((row) => row.health === PODS_REFUSED))
    return `${objects}, pods could not all be read`;
  if (rows.some((row) => row.health === PODS_UNREAD)) return `${objects}, pods not read yet`;

  return `${objects}, all healthy`;
}
