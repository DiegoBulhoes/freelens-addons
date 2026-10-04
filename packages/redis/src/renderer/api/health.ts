import { kindOf, masterOf, type RedisNode, readyCount } from "./nodes";
import type { RedisLike } from "./types";
import type { Verdict } from "./verdict";

function firstProblem(nodes: RedisNode[]): string | undefined {
  return nodes.find((each) => each.problem)?.problem;
}

function counted(object: RedisLike, nodes: RedisNode[]): Verdict | undefined {
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

/** For a sentinel, whether the replication it watches exists; nothing to say otherwise. */
export interface HealthContext {
  watchedExists?: boolean;
}

export function healthOf(
  object: RedisLike,
  nodes: RedisNode[],
  context: HealthContext = {},
): Verdict {
  const kind = kindOf(object);
  const { ready, wanted } = readyCount(object, nodes);
  const healthy: Verdict = {
    tone: "ok",
    label: "Healthy",
    reason: `${ready} of ${wanted} pods ready.`,
  };

  if (kind === "Cluster") {
    const state = object.status?.state;

    if (state === "Failed") {
      return {
        tone: "critical",
        label: "Failed",
        reason: object.status?.reason ?? firstProblem(nodes) ?? "The operator gave up on it.",
      };
    }

    const byPods = counted(object, nodes);

    if (byPods) return byPods;
    if (state && state !== "Ready") {
      return {
        tone: "info",
        label: state,
        reason: object.status?.reason ?? "The operator has not finished with it yet.",
      };
    }

    return healthy;
  }

  if (kind === "Sentinel") {
    const watched = object.spec.redisSentinelConfig?.redisReplicationName;

    if (context.watchedExists === false) {
      return {
        tone: "critical",
        label: "Watches nothing",
        reason: `The replication ${watched ?? "it names"} does not exist, so nothing fails over.`,
      };
    }

    const quorum = Number(object.spec.redisSentinelConfig?.quorum ?? 0);
    const byPods = counted(object, nodes);

    if (byPods && quorum > 0 && ready < quorum) {
      return {
        tone: "critical",
        label: "Below quorum",
        reason: `${ready} sentinels ready, ${quorum} needed to agree on a failover.${firstProblem(nodes) ? ` ${firstProblem(nodes)}` : ""}`,
      };
    }

    return byPods ?? healthy;
  }

  const byPods = counted(object, nodes);

  if (byPods) return byPods;

  if (kind === "Replication") {
    const labelled = masterOf(nodes)?.name;
    const recorded = object.status?.masterNode;

    if (!labelled) {
      return {
        tone: "critical",
        label: "No master",
        reason: "Every pod is up, but none is master: writes are refused.",
      };
    }

    if (recorded && recorded !== labelled) {
      return {
        tone: "info",
        label: "Changing master",
        reason: `The operator records ${recorded}; its pods still name ${labelled}. It settles within a minute.`,
      };
    }
  }

  return healthy;
}
