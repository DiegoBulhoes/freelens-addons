import type { RedisLike } from "../shared/types";
import { formatAge, type Verdict } from "../shared/verdict";
import { currentNodes, kindOf, masterOf, type RedisNode, readyCount } from "./nodes";

function firstProblem(nodes: RedisNode[]): string | undefined {
  return nodes.find((each) => each.problem)?.problem;
}

function podCountVerdict(object: RedisLike, nodes: RedisNode[]): Verdict | undefined {
  const { ready, wanted } = readyCount(object, nodes);
  const problem = firstProblem(nodes);

  if (ready === 0) {
    return { tone: "critical", label: "Down", reason: problem ?? "No pod is ready." };
  }

  if (ready < wanted) {
    return {
      tone: "warning",
      label: "Degraded",
      reason: `${ready} of ${wanted} pods ready.${problem ? ` ${problem}` : ""}`,
    };
  }

  return undefined;
}

/** Before the pods are read for this scope, an object with none would read as down. */
export const PODS_UNREAD: Verdict = {
  tone: "info",
  label: "Unknown",
  reason: "Its pods have not been read yet.",
};

/** Its namespace refused the pods or volumes: none listed is not none running. */
export const PODS_REFUSED: Verdict = {
  tone: "info",
  label: "Unknown",
  reason: "Its pods could not be read.",
};

/** For a sentinel, whether the replication it watches exists; `now`, to tell a cluster stuck. */
export interface HealthContext {
  watchedExists?: boolean;
  now?: number;
}

/** A bootstrap the operator finishes takes a few minutes once every pod is up. */
export const STUCK_AFTER_MS = 10 * 60_000;

/** The pod up the shortest time; NaN while one has no start time. */
function youngestOf(nodes: RedisNode[]): { name: string; since: number } {
  return currentNodes(nodes)
    .map((each) => ({ name: each.name, since: Date.parse(each.upSince ?? "") }))
    .reduce((a, b) => (Number.isNaN(b.since) || b.since > a.since ? b : a), {
      name: "",
      since: Number.NEGATIVE_INFINITY,
    });
}

function clusterHealth(
  object: RedisLike,
  nodes: RedisNode[],
  now: number | undefined,
  healthy: Verdict,
): Verdict {
  const state = object.status?.state;

  if (state === "Failed") {
    return {
      tone: "critical",
      label: "Failed",
      reason: object.status?.reason ?? firstProblem(nodes) ?? "The operator gave up on it.",
    };
  }

  const byPods = podCountVerdict(object, nodes);

  if (byPods) return byPods;

  if (state && state !== "Ready") {
    const youngest = youngestOf(nodes);
    const up = (now ?? Number.NaN) - youngest.since;

    if (up >= STUCK_AFTER_MS) {
      return {
        tone: "warning",
        label: `Stuck in ${state}`,
        reason: `Every pod has been up ${formatAge(up)} or more (the youngest is ${youngest.name}), and the operator still says ${state}. A pod back on a new IP leaves a ghost node; the cluster nodes command under Look further shows it.`,
      };
    }

    return {
      tone: "info",
      label: state,
      reason: object.status?.reason ?? "The operator has not finished with it yet.",
    };
  }

  return healthy;
}

function sentinelHealth(
  object: RedisLike,
  nodes: RedisNode[],
  watchedExists: boolean | undefined,
  healthy: Verdict,
): Verdict {
  const watched = object.spec.redisSentinelConfig?.redisReplicationName;

  if (watchedExists === false) {
    return {
      tone: "critical",
      label: "Watches nothing",
      reason: `The replication ${watched ?? "it names"} does not exist, so nothing fails over.`,
    };
  }

  const { ready } = readyCount(object, nodes);
  const quorum = Number(object.spec.redisSentinelConfig?.quorum ?? 0);
  const byPods = podCountVerdict(object, nodes);

  if (byPods && quorum > 0 && ready < quorum) {
    const problem = firstProblem(nodes);

    return {
      tone: "critical",
      label: "Below quorum",
      reason: `${ready} sentinels ready, ${quorum} needed to agree on a failover.${problem ? ` ${problem}` : ""}`,
    };
  }

  return byPods ?? healthy;
}

function replicationHealth(object: RedisLike, nodes: RedisNode[], healthy: Verdict): Verdict {
  const { ready, wanted } = readyCount(object, nodes);
  const byPods = podCountVerdict(object, nodes);

  if (ready > 0) {
    const master = masterOf(nodes);

    if (master && !master.ready) {
      return {
        tone: "critical",
        label: "Master down",
        reason: `${master.name} is master and not ready: writes are refused.${master.problem ? ` ${master.problem}` : ""}`,
      };
    }

    if (!master) {
      return {
        tone: "critical",
        label: "No master",
        reason: `${byPods ? `${ready} of ${wanted} pods ready, and none` : "Every pod is up, but none"} is master: writes are refused.`,
      };
    }
  }

  if (byPods) return byPods;

  const labelled = masterOf(nodes)?.name;
  const recorded = object.status?.masterNode;

  if (recorded && recorded !== labelled) {
    return {
      tone: "info",
      label: "Changing master",
      reason: `The operator records ${recorded}; its pods still name ${labelled}. It settles within a minute.`,
    };
  }

  return healthy;
}

export function healthOf(
  object: RedisLike,
  nodes: RedisNode[],
  context: HealthContext = {},
): Verdict {
  const { ready, wanted } = readyCount(object, nodes);
  const healthy: Verdict = {
    tone: "ok",
    label: "Healthy",
    reason: `${ready} of ${wanted} pods ready.`,
  };

  switch (kindOf(object)) {
    case "Cluster":
      return clusterHealth(object, nodes, context.now, healthy);
    case "Sentinel":
      return sentinelHealth(object, nodes, context.watchedExists, healthy);
    case "Replication":
      return replicationHealth(object, nodes, healthy);
    default:
      return podCountVerdict(object, nodes) ?? healthy;
  }
}
