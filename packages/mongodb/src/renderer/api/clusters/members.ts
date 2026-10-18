import type { PodLike, PvcLike, ReplicaSetLike } from "../shared/types";
import type { AgentView, ReplicationRole } from "./agent";

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
  /** Its data volume's claim, once found. */
  pvc?: string;
}

const ORDINAL = /-(\d+)$/;

function ordinalOf(name: string): number {
  return Number(ORDINAL.exec(name)?.[1] ?? 0);
}

export function isReady(
  pod: { status?: { conditions?: { type: string; status: string }[] } } | undefined,
): boolean {
  return (
    pod?.status?.conditions?.some((each) => each.type === "Ready" && each.status === "True") ===
    true
  );
}

function podProblem(pod: PodLike | undefined, podsKnown: boolean): string | undefined {
  if (!pod) return podsKnown ? "It has no pod yet." : undefined;

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

function volumeOf(
  name: string,
  namespace: string | undefined,
  pvcs: PvcLike[],
): { size?: string; problem?: string; pvc?: string } {
  const pvc = pvcs.find(
    (each) => each.getName() === `data-volume-${name}` && each.getNs() === namespace,
  );

  if (!pvc) return {};

  const size = pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage;
  const problem =
    pvc.status?.phase === "Pending"
      ? `Its volume ${pvc.getName()} is not bound (storage class ${pvc.spec?.storageClassName ?? "default"}).`
      : undefined;

  return { size, problem, pvc: pvc.getName() };
}

function priorityOf(rs: ReplicaSetLike, index: number): number | undefined {
  const raw = rs.spec.memberConfig?.[index]?.priority;

  return raw === undefined ? undefined : Number(raw);
}

function restartsOf(pod: PodLike | undefined): number {
  return (pod?.status?.containerStatuses ?? []).reduce((sum, each) => sum + each.restartCount, 0);
}

function mongodStartedAt(pod: PodLike | undefined): string | undefined {
  return pod?.status?.containerStatuses?.find((each) => each.name === "mongod")?.state?.running
    ?.startedAt;
}

function memberNamesOf(prefix: string, wanted: number, pods: PodLike[]): string[] {
  const names = new Set(Array.from({ length: wanted }, (_, at) => `${prefix}${at}`));

  for (const pod of pods) {
    const podName = pod.getName();
    const rest = podName.slice(prefix.length);

    if (podName.startsWith(prefix) && /^\d+$/.test(rest)) names.add(podName);
  }

  return [...names].sort((a, b) => ordinalOf(a) - ordinalOf(b));
}

function memberOf(
  rs: ReplicaSetLike,
  name: string,
  set: { arbiter: boolean; wanted: number },
  context: {
    pod: PodLike | undefined;
    pvcs: PvcLike[];
    agent: AgentView | undefined;
    podsKnown: boolean;
  },
): Member {
  const { arbiter, wanted } = set;
  const { pod, pvcs, agent, podsKnown } = context;
  const volume = volumeOf(name, rs.getNs(), pvcs);
  const index = arbiter ? undefined : ordinalOf(name);
  const ready = isReady(pod);

  return {
    name,
    arbiter,
    index,
    extra: ordinalOf(name) >= wanted,
    pod,
    ready,
    restarts: restartsOf(pod),
    node: pod?.spec?.nodeName,
    role: agent?.role ?? (arbiter && ready ? "arbiter" : undefined),
    inGoalState: agent?.inGoalState,
    upSince: mongodStartedAt(pod),
    problem: ready
      ? undefined
      : (volume.problem ?? podProblem(pod, podsKnown) ?? agent?.stuck ?? undefined),
    applying: ready ? agent?.stuck : undefined,
    priority: index === undefined ? undefined : priorityOf(rs, index),
    volume: volume.size,
    pvc: volume.pvc,
  };
}

/** Data members first, then arbiters, each by ordinal; pods left from a scale-down included. */
export function membersOf(
  rs: ReplicaSetLike,
  pods: PodLike[],
  pvcs: PvcLike[],
  agents: Record<string, AgentView | undefined>,
  /** False until the pods are read: a pod missing from an unread store is not missing. */
  podsKnown = true,
): Member[] {
  const name = rs.getName();
  const own = pods.filter((pod) => pod.getNs() === rs.getNs());
  const sets = [
    { arbiter: false, prefix: `${name}-`, wanted: rs.spec.members },
    { arbiter: true, prefix: `${name}-arb-`, wanted: rs.spec.arbiters ?? 0 },
  ];

  return sets.flatMap(({ arbiter, prefix, wanted }) =>
    memberNamesOf(prefix, wanted, own).map((member) =>
      memberOf(
        rs,
        member,
        { arbiter, wanted },
        {
          pod: own.find((each) => each.getName() === member),
          pvcs,
          agent: agents[member],
          podsKnown,
        },
      ),
    ),
  );
}

export function primaryOf(members: Member[]): Member | undefined {
  return members.find((each) => each.role === "primary");
}

/** The Primary column: unknown, not none, while a ready member's role is unread. */
export function primaryLabel(members: Member[]): string {
  const primary = primaryOf(members);

  if (primary) return primary.name;

  return dataMembers(members).some((each) => each.ready && each.role === undefined)
    ? "unknown"
    : "—";
}

export function currentMembers(members: Member[]): Member[] {
  return members.filter((each) => !each.extra);
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

  return { ready: currentMembers(members).filter((each) => each.ready).length, wanted };
}
