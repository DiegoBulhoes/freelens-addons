import { healthOf } from "./health";
import { kindOf, nodesOf, type RedisNode } from "./nodes";
import { sentinelsOf } from "./operations";
import type { PodLike, PvcLike, RedisKind, RedisLike, SecretMetaLike } from "./types";
import { type TlsView, tlsOf } from "./upkeep";
import { RANK, type Verdict } from "./verdict";

export interface Inventory {
  objects: RedisLike[];
  pods: PodLike[];
  pvcs: PvcLike[];
  /** Undefined until listed. */
  secrets?: SecretMetaLike[];
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

const replicationsOf = (objects: RedisLike[]) =>
  objects.filter((each) => kindOf(each) === "Replication");
const sentinelsIn = (objects: RedisLike[]) => objects.filter((each) => kindOf(each) === "Sentinel");

function relatedOf(object: RedisLike, objects: RedisLike[]): RedisLike[] {
  if (kindOf(object) === "Replication") return sentinelsOf(object, sentinelsIn(objects));
  if (kindOf(object) !== "Sentinel") return [];

  const watched = object.spec.redisSentinelConfig?.redisReplicationName;

  return replicationsOf(objects).filter(
    (each) => each.getNs() === object.getNs() && each.getName() === watched,
  );
}

/** Worst first, then by name. */
export function redisRows(inventory: Inventory): RedisRow[] {
  return inventory.objects
    .map((object) => {
      const nodes = nodesOf(object, inventory.pods, inventory.pvcs);
      const related = relatedOf(object, inventory.objects);
      const kind = kindOf(object);

      return {
        object,
        kind,
        nodes,
        related,
        health: healthOf(
          object,
          nodes,
          kind === "Sentinel" ? { watchedExists: related.length > 0 } : {},
        ),
        tls: tlsOf(object, inventory.secrets),
      };
    })
    .sort(
      (a, b) =>
        RANK[a.health.tone] - RANK[b.health.tone] ||
        a.object.getName().localeCompare(b.object.getName()),
    );
}

export function countsOf(rows: RedisRow[]) {
  const of = (kind: RedisKind) => rows.filter((row) => row.kind === kind).length;

  return {
    total: rows.length,
    down: rows.filter((row) => row.health.tone === "critical").length,
    degraded: rows.filter((row) => row.health.tone === "warning").length,
    replications: of("Replication"),
    clusters: of("Cluster"),
    standalones: of("Standalone"),
    sentinels: of("Sentinel"),
    unwatched: rows.filter((row) => row.kind === "Replication" && row.related.length === 0).length,
  };
}

export function describeHeadline(needing: number, total: number): string {
  if (total === 0) return "No Redis";
  if (needing === 0) return `${total} Redis object${total === 1 ? "" : "s"}, all healthy`;

  return `${needing} of ${total} Redis object${total === 1 ? "" : "s"} need${needing === 1 ? "s" : ""} attention`;
}
