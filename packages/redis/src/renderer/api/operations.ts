import { kindOf, masterOf, type RedisNode } from "./nodes";
import type { RedisLike } from "./types";
import { passwordCommand } from "./upkeep";

const MAX_SIZE = 50;
// Redis Cluster needs three masters to keep a majority when one fails.
const MIN_CLUSTER = 3;

export function scaleRefusal(object: RedisLike, count: number): string | undefined {
  const kind = kindOf(object);

  if (kind === "Standalone") return "A standalone Redis has one pod; there is nothing to scale.";
  if (!Number.isInteger(count) || count < 1) return "It needs at least one pod.";
  if (kind === "Cluster" && count < MIN_CLUSTER) {
    return `A Redis cluster needs at least ${MIN_CLUSTER} leaders.`;
  }
  if (count > MAX_SIZE) return `At most ${MAX_SIZE}.`;
  if (count === (object.spec.clusterSize ?? 1)) return `It already has ${count}.`;

  return undefined;
}

/** Said in the dialog, not refused. */
export function scaleWarnings(object: RedisLike, count: number): string[] {
  const kind = kindOf(object);
  const current = object.spec.clusterSize ?? 1;
  const warnings: string[] = [];

  if (count < current) {
    const prefix =
      kind === "Cluster"
        ? `${object.getName()}-leader`
        : kind === "Sentinel"
          ? `${object.getName()}-sentinel`
          : object.getName();
    const removed = Array.from({ length: current - count }, (_, at) => `${prefix}-${count + at}`);

    warnings.push(
      `Removes ${removed.join(", ")}${kind === "Cluster" ? " and their followers" : ""}; volumes are kept.`,
    );
  }

  if (kind === "Cluster")
    warnings.push(
      "The operator moves hash slots between leaders; that takes a while and loads the cluster.",
    );

  if (kind === "Sentinel") {
    const quorum = Number(object.spec.redisSentinelConfig?.quorum ?? 0);

    if (count % 2 === 0)
      warnings.push(`${count} sentinels can split evenly; an odd number avoids it.`);
    if (quorum > count)
      warnings.push(`Its quorum is ${quorum}: with ${count} sentinels no failover can be agreed.`);
  }

  if (kind === "Replication" && count === 1)
    warnings.push("With one pod there is no replica to fail over to.");

  return warnings;
}

export function scalePatch(object: RedisLike, count: number) {
  const spec: Record<string, unknown> = { clusterSize: count };

  if (object.spec.redisLeader?.replicas !== undefined) spec.redisLeader = { replicas: count };
  if (object.spec.redisFollower?.replicas !== undefined) spec.redisFollower = { replicas: count };

  return { spec };
}

/** Seen on the dev cluster: the pod returns on a new IP, and the operator leaves the old node behind. */
export const CLUSTER_RESTART_REFUSAL =
  "A restarted cluster pod comes back on a new IP, and redis-operator v0.26.0 neither rejoins it nor forgets the old node: the cluster stays in Bootstrap.";

export interface RestartStep {
  node: string;
  /** The master: meant to go after every replica. */
  last: boolean;
}

/** Replicas one at a time, then the master, each waiting for the set to settle. Not for a cluster. */
export function restartAllPlan(
  object: RedisLike,
  nodes: RedisNode[],
): { steps: RestartStep[] } | { refused: string } {
  if (kindOf(object) === "Cluster") return { refused: CLUSTER_RESTART_REFUSAL };

  const current = nodes.filter((each) => !each.extra);
  const down = current.filter((each) => !each.ready);

  if (down.length > 0) {
    return {
      refused: `${down.map((each) => each.name).join(", ")} ${down.length === 1 ? "is" : "are"} not ready; restarting the others could leave no copy.`,
    };
  }

  const isLast = (node: RedisNode) => node.role === "master";

  if (kindOf(object) === "Replication" && !masterOf(current)) {
    return { refused: "Its master could not be told from its pods' labels." };
  }

  return {
    steps: [
      ...current.filter((each) => !isLast(each)).map((each) => ({ node: each.name, last: false })),
      ...current.filter(isLast).map((each) => ({ node: each.name, last: true })),
    ],
  };
}

export function describeStep(step: RestartStep): string {
  return `restart ${step.node}`;
}

/** Re-checked against fresh state before each step. */
export function stepRefusal(
  object: RedisLike,
  step: RestartStep,
  nodes: RedisNode[],
): string | undefined {
  const node = nodes.find((each) => each.name === step.node);

  if (!node?.pod) return `${step.node} has no pod.`;
  if (nodes.some((each) => !each.extra && each.name !== step.node && !each.ready)) {
    return "Another pod is not ready.";
  }
  if (kindOf(object) === "Replication" && node.role === "master" && !step.last) {
    return `${step.node} became the master; it was meant to go last.`;
  }

  return undefined;
}

/** Every pod back and ready, and, for a replication, its recorded master the one its pods name. */
export function isSettled(object: RedisLike, nodes: RedisNode[]): boolean {
  const current = nodes.filter((each) => !each.extra);

  if (current.length === 0 || current.some((each) => !each.ready)) return false;

  if (kindOf(object) === "Replication") {
    const master = masterOf(current)?.name;

    // A replica answers its probe before the operator relinks it: until its role is set, it may still be resyncing.
    return (
      Boolean(master) &&
      current.every((each) => each.role !== undefined) &&
      (!object.status?.masterNode || object.status.masterNode === master)
    );
  }

  return true;
}

export function memberRestartRefusal(
  object: RedisLike,
  nodes: RedisNode[],
  name: string,
): string | undefined {
  if (kindOf(object) === "Cluster") return CLUSTER_RESTART_REFUSAL;

  const node = nodes.find((each) => each.name === name);

  if (!node?.pod) return `${name} has no pod to restart.`;

  const others = nodes.filter((each) => !each.extra && each.name !== name);

  if (node.ready && others.some((each) => !each.ready)) {
    return "Another pod is not ready; restarting this one now could leave no copy.";
  }

  return undefined;
}

/** The sentinels watching a replication. */
export function sentinelsOf(replication: RedisLike, sentinels: RedisLike[]): RedisLike[] {
  return sentinels.filter(
    (each) =>
      each.getNs() === replication.getNs() &&
      each.spec.redisSentinelConfig?.redisReplicationName === replication.getName(),
  );
}

export function failoverRefusal(
  replication: RedisLike,
  nodes: RedisNode[],
  sentinel: RedisLike | undefined,
  sentinelNodes: RedisNode[],
): string | undefined {
  if (kindOf(replication) !== "Replication") return "Only a replication fails over.";
  if (!sentinel) return "No sentinel watches it: without one there is nothing to run a failover.";
  if (!sentinelNodes.some((each) => each.ready)) return `No pod of ${sentinel.getName()} is ready.`;
  if (!masterOf(nodes)) return "It has no master to fail over from.";
  if (!nodes.some((each) => each.role === "replica" && each.ready)) {
    return "It has no ready replica to promote.";
  }

  return undefined;
}

function authFlag(object: RedisLike): string {
  // REDIS_PASSWORD is set in the pod from the object's Secret; it is expanded there, not here.
  return object.spec.kubernetesConfig?.redisSecret?.name
    ? ' --no-auth-warning -a "$REDIS_PASSWORD"'
    : "";
}

function tlsFlags(object: RedisLike): string {
  return object.spec.TLS?.secret?.secretName
    ? ' --tls --cacert "$REDIS_TLS_CA_CERT" --cert "$REDIS_TLS_CERT" --key "$REDIS_TLS_CERT_KEY"'
    : "";
}

/** Run in a sentinel pod: asks the sentinels to promote a replica, as SENTINEL FAILOVER does. */
export function failoverCommand(sentinel: RedisLike): string[] {
  const group = sentinel.spec.redisSentinelConfig?.masterGroupName ?? "myMaster";

  return [
    "sh",
    "-c",
    `redis-cli -p 26379${tlsFlags(sentinel)}${authFlag(sentinel)} SENTINEL failover ${group}`,
  ];
}

/** Opens redis-cli in a pod; the password is expanded inside it and never leaves the pod. */
export function redisCliCommand(object: RedisLike, node: RedisNode): string {
  const kind = kindOf(object);
  const flags = `${kind === "Cluster" ? " -c" : ""}${kind === "Sentinel" ? " -p 26379" : ""}${tlsFlags(object)}${authFlag(object)}`;

  return `kubectl exec -it -n ${object.getNs() ?? "default"} ${node.name}${node.container ? ` -c ${node.container}` : ""} -- sh -c 'exec redis-cli${flags}'`;
}

export function commandsOf(object: RedisLike): { label: string; command: string }[] {
  const namespace = object.getNs() ?? "default";
  const name = object.getName();
  const kind = kindOf(object);
  const resource = {
    Replication: "redisreplication",
    Cluster: "rediscluster",
    Standalone: "redis",
    Sentinel: "redissentinel",
  }[kind];
  const password = passwordCommand(object);

  return [
    {
      label: "Its spec, status and events",
      command: `kubectl describe ${resource} -n ${namespace} ${name}`,
    },
    {
      label: "The operator's log for it",
      command: `kubectl logs -n redis-operator-system deploy/redis-operator-redis-operator | grep '"${name}"'`,
    },
    ...(password ? [{ label: "The password, from its Secret", command: password }] : []),
  ];
}
