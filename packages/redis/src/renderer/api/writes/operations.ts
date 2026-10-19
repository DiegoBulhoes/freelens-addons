import {
  crdKindOf,
  currentNodes,
  kindOf,
  masterOf,
  type RedisNode,
  setsOf,
  sizeOf,
} from "../objects/nodes";
import { passwordCommand, passwordSecretOf, tlsSecretOf } from "../objects/upkeep";
import type { Command } from "../shared/commands";
import type { PodLike, RedisKind, RedisLike } from "../shared/types";

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
  if (count === sizeOf(object)) return `It already has ${count}.`;

  return undefined;
}

/** Said in the dialog, not refused. */
export function scaleWarnings(object: RedisLike, count: number): string[] {
  const kind = kindOf(object);
  const current = sizeOf(object);
  const warnings: string[] = [];

  if (count < current) {
    const prefix = setsOf(object)[0]?.app ?? object.getName();
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

/** Said under the size while it is typed, before anything is sent. */
export function scaleAdvice(
  object: RedisLike,
  text: string,
): { refused?: string; warnings: string[] } {
  const count = Number(text.trim());

  // The size it opens with is no mistake to point at.
  if (count === sizeOf(object)) return { warnings: [] };

  const refused = scaleRefusal(object, count);

  return refused ? { refused, warnings: [] } : { warnings: scaleWarnings(object, count) };
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

  const current = currentNodes(nodes);
  const down = current.filter((each) => !each.ready);

  if (down.length > 0) {
    return {
      refused: `${down.map((each) => each.name).join(", ")} ${down.length === 1 ? "is" : "are"} not ready; restarting the others could leave no copy.`,
    };
  }

  const isMaster = (node: RedisNode) => node.role === "master";

  if (kindOf(object) === "Replication" && !masterOf(current)) {
    return { refused: "Its master could not be told from its pods' labels." };
  }

  const masters = current.filter(isMaster);

  if (kindOf(object) === "Replication" && masters.length > 1) {
    return {
      refused: `${masters.map((each) => each.name).join(" and ")} are each labelled master; wait until the operator relinks all but one.`,
    };
  }

  return {
    steps: [
      ...current
        .filter((each) => !isMaster(each))
        .map((each) => ({ node: each.name, last: false })),
      ...current.filter(isMaster).map((each) => ({ node: each.name, last: true })),
    ],
  };
}

export function restartAllRefusal(plan: ReturnType<typeof restartAllPlan>): string | undefined {
  return "refused" in plan ? plan.refused : undefined;
}

export function describeStep(step: RestartStep): string {
  return `restart ${step.node}`;
}

export function describeRestartStart(name: string, steps: RestartStep[]): string {
  return `Restarting ${name}, one pod at a time: ${steps.map((step) => step.node).join(", then ")}.`;
}

export function describeStepDone(name: string, step: RestartStep, at: number, total: number) {
  return `${name}: ${describeStep(step)}, done (${at} of ${total}).`;
}

/** Per kind, what a bulk Restart does; a cluster has none, since every one would be refused. */
export const BULK_RESTART_TOOLTIP: Partial<Record<RedisKind, string>> = {
  Replication: "Restarts every pod of each ticked one, replicas first and the master last.",
  Sentinel: "Restarts every sentinel pod of each ticked one, one at a time.",
  Standalone: "Restarts the pod of each ticked one; clients cannot connect until it is back.",
};

/** Re-checked against fresh state before each step. */
export function stepRefusal(
  object: RedisLike,
  step: RestartStep,
  nodes: RedisNode[],
): string | undefined {
  const node = nodes.find((each) => each.name === step.node);

  // Its uid is how the step knows the pod came back: start times depend on the clocks.
  if (!node?.pod?.metadata.uid) return `${step.node} has no pod.`;
  if (currentNodes(nodes).some((each) => each.name !== step.node && !each.ready)) {
    return "Another pod is not ready.";
  }
  if (kindOf(object) === "Replication" && node.role === "master" && !step.last) {
    return `${step.node} became the master; it was meant to go last.`;
  }

  return undefined;
}

/** A pod deleted and made again by its StatefulSet keeps its name and gets a new uid. */
export function podReplaced(pod: PodLike | undefined, uid: string): boolean {
  return Boolean(pod?.metadata.uid) && pod?.metadata.uid !== uid;
}

/** Every pod back and ready, and, for a replication, its recorded master the one its pods name. */
export function isSettled(object: RedisLike, nodes: RedisNode[]): boolean {
  const current = currentNodes(nodes);

  if (current.length === 0 || current.some((each) => !each.ready)) return false;

  if (kindOf(object) === "Replication") {
    const master = masterOf(current)?.name;
    // A restarted replica starts as a master and is labelled one until the operator relinks it.
    const masters = current.filter((each) => each.role === "master").length;

    // A replica answers its probe before the operator relinks it: until its role is set, it may still be resyncing.
    return (
      masters === 1 &&
      current.every((each) => each.role !== undefined) &&
      (!object.status?.masterNode || object.status.masterNode === master)
    );
  }

  return true;
}

export function nodeRestartRefusal(
  object: RedisLike,
  nodes: RedisNode[],
  name: string,
): string | undefined {
  if (kindOf(object) === "Cluster") return CLUSTER_RESTART_REFUSAL;

  const node = nodes.find((each) => each.name === name);

  if (!node?.pod) return `${name} has no pod to restart.`;

  const others = currentNodes(nodes).filter((each) => each.name !== name);

  if (node.ready && others.some((each) => !each.ready)) {
    return "Another pod is not ready; restarting this one now could leave no copy.";
  }

  return undefined;
}

/** At OK, on a fresh read: the checks again, and the role the dialog described. */
export function nodeRestartRefusalNow(
  object: RedisLike,
  nodes: RedisNode[],
  name: string,
  confirmed: RedisNode["role"],
): string | undefined {
  const refused = nodeRestartRefusal(object, nodes, name);

  if (refused) return refused;

  const role = nodes.find((each) => each.name === name)?.role;

  return role === confirmed
    ? undefined
    : `${name} is now ${role ?? "without a role"}, not the ${confirmed ?? "pod without a role"} confirmed; nothing was changed.`;
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
  return passwordSecretOf(object)?.name ? ' --no-auth-warning -a "$REDIS_PASSWORD"' : "";
}

function tlsFlags(object: RedisLike): string {
  return tlsSecretOf(object)
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

/** Run in a sentinel pod: one line per replica it knows, its IP and its flags. */
export function sentinelReplicasCommand(sentinel: RedisLike): string[] {
  const group = sentinel.spec.redisSentinelConfig?.masterGroupName ?? "myMaster";

  return [
    "sh",
    "-c",
    `redis-cli -p 26379${tlsFlags(sentinel)}${authFlag(sentinel)} SENTINEL replicas ${group} | awk 'NR % 2 == 1 { key = $0; next } key == "ip" { ip = $0 } key == "flags" { print ip, $0 }'`,
  ];
}

/** The replicas a sentinel does not list as up: its failover reconfigures only those it lists. */
export function replicasUnknownToSentinel(listed: string, replicas: RedisNode[]): string[] {
  const up = new Set(
    listed
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter(([, flags]) => flags !== undefined && !/s_down|o_down|disconnected/.test(flags))
      .map(([ip]) => ip),
  );

  return replicas
    .filter((each) => !each.pod?.status?.podIP || !up.has(each.pod.status.podIP))
    .map((each) => each.name);
}

/** Opens redis-cli in a pod; the password is expanded inside it and never leaves the pod. */
export function redisCliCommand(object: RedisLike, node: RedisNode): string {
  const kind = kindOf(object);
  const flags = `${kind === "Cluster" ? " -c" : ""}${kind === "Sentinel" ? " -p 26379" : ""}${tlsFlags(object)}${authFlag(object)}`;

  return `kubectl exec -it -n ${object.getNs() ?? "default"} ${node.name}${node.container ? ` -c ${node.container}` : ""} -- sh -c 'exec redis-cli${flags}'`;
}

// Helm and kustomize installs name the Deployment and namespace differently; the image is the same.
const OPERATOR_IMAGE = "/redis-operator[:@]";
const FIND_OPERATOR = `kubectl get deployments -A --no-headers -o 'custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,IMAGES:.spec.template.spec.containers[*].image' | awk '$3 ~ /\\${OPERATOR_IMAGE}/ { print "-n", $1, "deploy/" $2; exit }'`;

export function commandsOf(object: RedisLike): Command[] {
  const namespace = object.getNs() ?? "default";
  const name = object.getName();
  const kind = kindOf(object);
  const resource = crdKindOf(kind).toLowerCase();
  const password = passwordCommand(object);

  return [
    {
      label: "Its spec, status and events",
      command: `kubectl describe ${resource} -n ${namespace} ${name}`,
    },
    {
      label: "Where the redis-operator runs, found by its image",
      command: `kubectl get deployments -A -o wide | grep -E '${OPERATOR_IMAGE}'`,
    },
    {
      label: "The operator's log for it, wherever the operator runs",
      command: `${FIND_OPERATOR} | xargs kubectl logs | grep '"${name}"'`,
    },
    ...(kind === "Cluster"
      ? [
          {
            label: "Its nodes as the cluster sees them; a ghost node reads fail or noaddr",
            command: `kubectl exec -n ${namespace} ${name}-leader-0 -c ${name}-leader -- sh -c 'redis-cli${tlsFlags(object)}${authFlag(object)} cluster nodes'`,
          },
        ]
      : []),
    ...(password ? [{ label: "The password, from its Secret", command: password }] : []),
  ];
}
