import type { PodLike, PvcLike, RedisKind, RedisLike } from "../shared/types";

export type SetGroup = "leader" | "follower";

export type NodeRole = "master" | "replica" | "sentinel" | "standalone";

export interface RedisNode {
  name: string;
  /** For a cluster: which StatefulSet it belongs to. */
  group?: SetGroup;
  pod?: PodLike;
  container?: string;
  ready: boolean;
  restarts: number;
  node?: string;
  /** From the operator's redis-role label; it follows a failover about half a minute late. */
  role?: NodeRole;
  upSince?: string;
  problem?: string;
  volume?: string;
  /** Its PersistentVolumeClaim's name, once the claim exists. */
  claim?: string;
  /** Beyond the size asked for: left from a scale-down. */
  extra: boolean;
}

const CRD_KINDS: Record<RedisKind, string> = {
  Standalone: "Redis",
  Replication: "RedisReplication",
  Cluster: "RedisCluster",
  Sentinel: "RedisSentinel",
};

const KINDS = Object.fromEntries(
  Object.entries(CRD_KINDS).map(([kind, crd]) => [crd, kind]),
) as Record<string, RedisKind>;

export function kindOf(object: RedisLike): RedisKind {
  return KINDS[object.kind] ?? "Standalone";
}

/** The CRD's own kind, as `object.kind` carries it. */
export function crdKindOf(kind: RedisKind): string {
  return CRD_KINDS[kind];
}

export const sizeOf = (object: RedisLike): number => object.spec.clusterSize ?? 1;

/** The StatefulSets the operator makes for an object, with how many pods each should have. */
export function setsOf(object: RedisLike): { app: string; wanted: number; group?: SetGroup }[] {
  const name = object.getName();
  const size = sizeOf(object);

  switch (kindOf(object)) {
    case "Cluster":
      return [
        {
          app: `${name}-leader`,
          wanted: object.spec.redisLeader?.replicas ?? size,
          group: "leader",
        },
        {
          app: `${name}-follower`,
          wanted: object.spec.redisFollower?.replicas ?? size,
          group: "follower",
        },
      ];
    case "Sentinel":
      return [{ app: `${name}-sentinel`, wanted: size }];
    case "Replication":
      return [{ app: name, wanted: size }];
    default:
      return [{ app: name, wanted: 1 }];
  }
}

export function isReady(pod: PodLike | undefined): boolean {
  return (
    pod?.status?.conditions?.some((each) => each.type === "Ready" && each.status === "True") ===
    true
  );
}

function podProblem(pod: PodLike | undefined): string | undefined {
  if (!pod) return "It has no pod yet.";

  const unscheduled = pod.status?.conditions?.find(
    (each) => each.type === "PodScheduled" && each.status === "False",
  );

  if (unscheduled)
    return `Not scheduled: ${unscheduled.message ?? unscheduled.reason ?? ""}`.trim();

  for (const container of pod.status?.containerStatuses ?? []) {
    const waiting = container.state?.waiting;

    if (waiting?.reason && waiting.reason !== "ContainerCreating") {
      return `${container.name}: ${waiting.reason}${waiting.message ? `, ${waiting.message}` : ""}`;
    }

    const terminated = container.lastState?.terminated;

    if (!container.ready && terminated?.reason) {
      return `${container.name} last exited: ${terminated.reason} (code ${terminated.exitCode ?? "?"})`;
    }
  }

  return undefined;
}

function roleOf(kind: RedisKind, pod: PodLike | undefined): NodeRole | undefined {
  if (kind === "Sentinel") return "sentinel";
  if (kind === "Standalone") return "standalone";

  const label = pod?.metadata.labels?.["redis-role"];

  return label === "master" ? "master" : label === "slave" ? "replica" : undefined;
}

const ORDINAL = /-(\d+)$/;

const ordinalOf = (name: string): number => Number(ORDINAL.exec(name)?.[1] ?? 0);

function nodeOf(
  name: string,
  set: ReturnType<typeof setsOf>[number],
  kind: RedisKind,
  own: PodLike[],
  pvcs: PvcLike[],
  namespace: string | undefined,
): RedisNode {
  const pod = own.find((each) => each.getName() === name);
  const pvc = pvcs.find(
    (each) => each.getName() === `${set.app}-${name}` && each.getNs() === namespace,
  );
  const volumeProblem =
    pvc?.status?.phase === "Pending"
      ? `Its volume ${pvc.getName()} is not bound (storage class ${pvc.spec?.storageClassName ?? "default"}).`
      : undefined;
  const ready = isReady(pod);
  const container = pod?.spec?.containers?.[0]?.name;

  return {
    name,
    group: set.group,
    pod,
    container,
    ready,
    restarts: (pod?.status?.containerStatuses ?? []).reduce(
      (sum, each) => sum + each.restartCount,
      0,
    ),
    node: pod?.spec?.nodeName,
    role: roleOf(kind, pod),
    upSince: pod?.status?.containerStatuses?.find((each) => each.name === container)?.state?.running
      ?.startedAt,
    problem: ready ? undefined : (volumeProblem ?? podProblem(pod)),
    volume: pvc?.status?.capacity?.storage ?? pvc?.spec?.resources?.requests?.storage,
    claim: pvc?.getName(),
    extra: ordinalOf(name) >= set.wanted,
  };
}

/** Every pod the object should have, and any left from a scale-down, in StatefulSet order. */
export function nodesOf(object: RedisLike, pods: PodLike[], pvcs: PvcLike[]): RedisNode[] {
  const namespace = object.getNs();
  const kind = kindOf(object);
  const own = pods.filter((pod) => pod.getNs() === namespace);

  return setsOf(object).flatMap((set) => {
    const names = new Set(Array.from({ length: set.wanted }, (_, at) => `${set.app}-${at}`));

    for (const pod of own) {
      if (pod.metadata.labels?.app === set.app) names.add(pod.getName());
    }

    return [...names]
      .sort((a, b) => ordinalOf(a) - ordinalOf(b))
      .map((name) => nodeOf(name, set, kind, own, pvcs, namespace));
  });
}

/** The pods the object should have, not those left from a scale-down. */
export const currentNodes = (nodes: RedisNode[]): RedisNode[] =>
  nodes.filter((each) => !each.extra);

export function masterOf(nodes: RedisNode[]): RedisNode | undefined {
  return nodes.find((each) => each.role === "master");
}

/** Where redis-cli opens: the master while it is ready, else any ready pod. */
export function cliTarget(nodes: RedisNode[]): RedisNode | undefined {
  const master = masterOf(nodes);

  return master?.ready ? master : nodes.find((each) => each.ready);
}

/** The object's own pods and volumes, which carry the `app` label of their StatefulSet. */
export function appSelector(object: RedisLike): string {
  const apps = setsOf(object).map((each) => each.app);

  return `app in (${apps.join(",")})`;
}

export function readyCount(
  object: RedisLike,
  nodes: RedisNode[],
): { ready: number; wanted: number } {
  const wanted = setsOf(object).reduce((sum, each) => sum + each.wanted, 0);

  return { ready: currentNodes(nodes).filter((each) => each.ready).length, wanted };
}
