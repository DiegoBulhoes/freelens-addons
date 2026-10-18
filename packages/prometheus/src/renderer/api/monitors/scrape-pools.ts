import { withoutQuery } from "../shared/prometheus-api";
import { objectKey } from "../shared/selectors";
import type { RuleGroup, Target } from "../shared/types";

export type PoolKind = "ServiceMonitor" | "PodMonitor" | "Probe" | "ScrapeConfig";

export interface PoolRef {
  kind: PoolKind;
  namespace: string;
  name: string;
  /** The endpoint index; a Probe and a ScrapeConfig have none. */
  index?: number;
}

const POOL = /^(serviceMonitor|podMonitor|probe|scrapeConfig)\/([^/]+)\/([^/]+)(?:\/(\d+))?$/;

const KINDS: Record<string, PoolKind> = {
  serviceMonitor: "ServiceMonitor",
  podMonitor: "PodMonitor",
  probe: "Probe",
  scrapeConfig: "ScrapeConfig",
};

/** The operator's job names; a pool from additionalScrapeConfigs gives undefined. */
export function parsePool(pool: string): PoolRef | undefined {
  const match = POOL.exec(pool);

  if (!match) return undefined;

  const [, kind = "", namespace = "", name = "", index] = match;

  return {
    kind: KINDS[kind] as PoolKind,
    namespace,
    name,
    index: index === undefined ? undefined : Number(index),
  };
}

const keyOfPool = (ref: PoolRef) => objectKey(ref.kind, ref.namespace, ref.name);

/** What one Prometheus answered, merged over its shards; a field stays undefined when it was not read. */
export interface PrometheusRead {
  source: string;
  pools?: string[];
  targets?: Target[];
  groups?: RuleGroup[];
  error?: string;
}

/** Each shard scrapes its own part of the targets; every shard loads the same pools and rules. */
export function mergeShards(
  source: string,
  shards: { pools?: string[]; targets?: Target[]; groups?: RuleGroup[]; error?: string }[],
): PrometheusRead {
  const answered = shards.filter((shard) => !shard.error);
  const failed = shards.find((shard) => shard.error);

  // One shard left unread would hide its targets, so the whole read is unknown.
  if (failed || answered.length === 0) {
    return { source, error: failed?.error ?? "No Prometheus pod is running and ready" };
  }

  const all = <T>(pick: (shard: (typeof answered)[number]) => T[] | undefined) =>
    answered.every((shard) => pick(shard) !== undefined)
      ? answered.flatMap((shard) => pick(shard) ?? [])
      : undefined;
  const pools = all((shard) => shard.pools);

  return {
    source,
    pools: pools && [...new Set(pools)],
    targets: all((shard) => shard.targets),
    groups: answered[0]?.groups,
  };
}

/** Monitors with a loaded pool, keyed kind/namespace/name, with the endpoint indexes loaded. */
export function poolsLoaded(pools: string[]): Map<string, Set<number | undefined>> {
  const loaded = new Map<string, Set<number | undefined>>();

  for (const pool of pools) {
    const ref = parsePool(pool);

    if (!ref) continue;

    const key = keyOfPool(ref);
    const indexes = loaded.get(key) ?? new Set();

    indexes.add(ref.index);
    loaded.set(key, indexes);
  }

  return loaded;
}

export interface Health {
  up: number;
  down: number;
  unknown: number;
  /** Each down target's error, its URL without a query. */
  errors: { pool: string; scrapeUrl: string; lastError: string }[];
  targets: Target[];
}

export const emptyHealth = (): Health => ({ up: 0, down: 0, unknown: 0, errors: [], targets: [] });

export function healthByMonitor(targets: Target[]): Map<string, Health> {
  const health = new Map<string, Health>();

  for (const target of targets) {
    const ref = parsePool(target.scrapePool);

    if (!ref) continue;

    const key = keyOfPool(ref);
    const entry = health.get(key) ?? emptyHealth();

    entry[target.health] += 1;
    entry.targets.push(target);
    if (target.health === "down") {
      entry.errors.push({
        pool: target.scrapePool,
        scrapeUrl: target.scrapeUrl,
        lastError: target.lastError,
      });
    }
    health.set(key, entry);
  }

  return health;
}

// Targets can share labels and differ only in stripped params, so a repeat gets a counter.
export function keyedTargets(targets: Target[]): { key: string; target: Target }[] {
  const seen = new Map<string, number>();

  return targets.map((target) => {
    const base = `${target.scrapePool}${JSON.stringify(target.labels)}`;
    const count = seen.get(base) ?? 0;

    seen.set(base, count + 1);

    return { key: count === 0 ? base : `${base}#${count}`, target };
  });
}

export function shownInstance(target: Target): string | undefined {
  const { instance } = target.labels;

  return instance && !target.scrapeUrl.includes(instance) ? withoutQuery(instance) : undefined;
}
