import type { AgentView, ReplicationRole } from "./agent";
import type { PodLike, PvcLike, ReplicaSetLike } from "./types";

export interface Member {
  name: string;
  arbiter: boolean;
  /** Its index in spec.memberConfig, for a data member. */
  index?: number;
  /** Beyond spec.members or spec.arbiters: left over from a scale-down. */
  extra: boolean;
  pod?: PodLike;
  ready: boolean;
  restarts: number;
  node?: string;
  /** From the agent; undefined when it could not be read. */
  role?: ReplicationRole;
  inGoalState?: boolean;
  /** When its mongod container started; the agent's LastMongoUpTime is only when it last saw it up. */
  upSince?: string;
  /** Why it is not running, from its pod, its volumes or its agent. */
  problem?: string;
  /** Up, but its agent is still working through a change: the step it is on. */
  applying?: string;
  priority?: number;
  volume?: string;
}

const ORDINAL = /-(\d+)$/;

function ordinalOf(name: string): number {
  return Number(ORDINAL.exec(name)?.[1] ?? 0);
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

function volumeOf(name: string, pvcs: PvcLike[]): { size?: string; problem?: string } {
  const pvc = pvcs.find((each) => each.getName() === `data-volume-${name}`);

  if (!pvc) return {};

  const size = pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage;
  const problem =
    pvc.status?.phase === "Pending"
      ? `Its volume ${pvc.getName()} is not bound (storage class ${pvc.spec?.storageClassName ?? "default"}).`
      : undefined;

  return { size, problem };
}

function priorityOf(rs: ReplicaSetLike, index: number): number | undefined {
  const raw = rs.spec.memberConfig?.[index]?.priority;

  return raw === undefined ? undefined : Number(raw);
}

/** Data members first, then arbiters, each by ordinal; pods left from a scale-down included. */
export function membersOf(
  rs: ReplicaSetLike,
  pods: PodLike[],
  pvcs: PvcLike[],
  agents: Record<string, AgentView | undefined>,
): Member[] {
  const name = rs.getName();
  const namespace = rs.getNs();
  const own = pods.filter((pod) => pod.getNs() === namespace);
  const sets = [
    { arbiter: false, prefix: `${name}-`, wanted: rs.spec.members },
    { arbiter: true, prefix: `${name}-arb-`, wanted: rs.spec.arbiters ?? 0 },
  ];

  return sets.flatMap(({ arbiter, prefix, wanted }) => {
    const names = new Set(Array.from({ length: wanted }, (_, at) => `${prefix}${at}`));

    for (const pod of own) {
      const podName = pod.getName();
      const rest = podName.slice(prefix.length);

      if (podName.startsWith(prefix) && /^\d+$/.test(rest)) names.add(podName);
    }

    return [...names]
      .sort((a, b) => ordinalOf(a) - ordinalOf(b))
      .map((member): Member => {
        const pod = own.find((each) => each.getName() === member);
        const agent = agents[member];
        const volume = volumeOf(member, pvcs);
        const index = arbiter ? undefined : ordinalOf(member);

        return {
          name: member,
          arbiter,
          index,
          extra: ordinalOf(member) >= wanted,
          pod,
          ready: isReady(pod),
          restarts: (pod?.status?.containerStatuses ?? []).reduce(
            (sum, each) => sum + each.restartCount,
            0,
          ),
          node: pod?.spec?.nodeName,
          role: agent?.role ?? (arbiter && isReady(pod) ? "arbiter" : undefined),
          inGoalState: agent?.inGoalState,
          upSince: pod?.status?.containerStatuses?.find((each) => each.name === "mongod")?.state
            ?.running?.startedAt,
          problem: isReady(pod)
            ? undefined
            : (volume.problem ?? podProblem(pod) ?? agent?.stuck ?? undefined),
          applying: isReady(pod) ? agent?.stuck : undefined,
          priority: index === undefined ? undefined : priorityOf(rs, index),
          volume: volume.size,
        };
      });
  });
}

export function primaryOf(members: Member[]): Member | undefined {
  return members.find((each) => each.role === "primary");
}

export function dataMembers(members: Member[]): Member[] {
  return members.filter((each) => !each.arbiter && !each.extra);
}

/** The member a raised priority makes primary whenever it can be. */
export function preferredOf(members: Member[]): Member | undefined {
  const priorities = dataMembers(members).map((each) => each.priority ?? 1);

  // With one data member there is nothing to prefer it over.
  if (priorities.length < 2) return undefined;
  const highest = Math.max(...priorities);

  if (priorities.filter((each) => each === highest).length !== 1) return undefined;

  return dataMembers(members).find((each) => (each.priority ?? 1) === highest);
}

export function readyCount(
  rs: ReplicaSetLike,
  members: Member[],
): { ready: number; wanted: number } {
  const wanted = rs.spec.members + (rs.spec.arbiters ?? 0);

  return { ready: members.filter((each) => each.ready && !each.extra).length, wanted };
}
