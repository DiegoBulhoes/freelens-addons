import { type Member, primaryOf } from "./members";
import { runningVersion } from "./replica-sets";
import type { MemberConfig, ReplicaSetLike, UserSpec } from "./types";

const VERSION = /^(\d+)\.(\d+)\.(\d+)(-ent)?$/;

export const RESTARTED_AT = "mongodb.com/restartedAt";

export function seriesOf(version: string | undefined): string | undefined {
  const match = VERSION.exec(version ?? "");

  return match ? `${match[1]}.${match[2]}` : undefined;
}

/** The FCV in effect: the spec's, else the series the agent sets by default. */
export function effectiveFcv(rs: ReplicaSetLike): string | undefined {
  return rs.spec.featureCompatibilityVersion ?? seriesOf(runningVersion(rs));
}

const MAX_MEMBERS = 50;
// MongoDB counts at most seven voters.
const MAX_VOTERS = 7;

function memberConfigFor(rs: ReplicaSetLike, count: number): MemberConfig[] | undefined {
  const current = rs.spec.memberConfig;

  if (!current) return undefined;

  return Array.from({ length: count }, (_, at) => current[at] ?? { votes: 1, priority: "1" });
}

export function scaleRefusal(rs: ReplicaSetLike, count: number): string | undefined {
  if (!Number.isInteger(count) || count < 1) return "A cluster needs at least one member.";
  if (count > MAX_MEMBERS) return `MongoDB allows at most ${MAX_MEMBERS} members.`;
  if (count === rs.spec.members) return `It already has ${count} members.`;

  return undefined;
}

/** Said in the dialog, not refused: these are legitimate but worth a second look. */
export function scaleWarnings(rs: ReplicaSetLike, count: number): string[] {
  const warnings: string[] = [];
  const voters = Math.min(count, MAX_VOTERS) + (rs.spec.arbiters ?? 0);

  if (voters % 2 === 0) {
    warnings.push(
      `${voters} voting members can split evenly: an election may find no majority. An odd number, or an arbiter, avoids it.`,
    );
  }

  if (count < rs.spec.members) {
    const removed = Array.from(
      { length: rs.spec.members - count },
      (_, at) => `${rs.getName()}-${count + at}`,
    );

    warnings.push(`Removes ${removed.join(", ")}; their volumes are kept.`);
  }

  if (count === 1) warnings.push("With one member there is no copy to fail over to.");

  return warnings;
}

export function scalePatch(rs: ReplicaSetLike, count: number) {
  const memberConfig = memberConfigFor(rs, count);

  return { spec: { members: count, ...(memberConfig ? { memberConfig } : {}) } };
}

export function switchRefusal(
  rs: ReplicaSetLike,
  members: Member[],
  target: string,
): string | undefined {
  const member = members.find((each) => each.name === target);

  if (rs.status?.phase !== "Running") return "Only a running cluster can elect a new primary.";
  if (!member || member.arbiter || member.extra) return `${target} is not a data member.`;
  if (member.role === undefined) return `${target}'s role could not be read from its agent.`;
  if (member.role === "primary") return `${target} is already the primary.`;
  if (!member.ready || member.role !== "secondary") return `${target} is not a ready secondary.`;
  if (!primaryOf(members)) return "There is no primary to step down.";
  if (members.some((each) => !each.extra && each.inGoalState === false)) {
    return "A member is still applying its last change; electing now would make members take the primary from each other.";
  }

  return undefined;
}

/** The target outranks every other member, so it calls an election and wins it. */
export function switchPatch(rs: ReplicaSetLike, members: Member[], target: string) {
  const count = rs.spec.members;
  const current = memberConfigFor(rs, count) ?? [];
  const index = members.find((each) => each.name === target)?.index ?? -1;

  return {
    spec: {
      memberConfig: Array.from({ length: count }, (_, at) => ({
        ...current[at],
        votes: current[at]?.votes ?? 1,
        priority: at === index ? "2" : "1",
      })),
    },
  };
}

export function rollingRestartPatch(now: number) {
  return {
    spec: {
      statefulSet: {
        spec: {
          template: { metadata: { annotations: { [RESTARTED_AT]: new Date(now).toISOString() } } },
        },
      },
    },
  };
}

export function rollingRestartRefusal(rs: ReplicaSetLike): string | undefined {
  return rs.status?.phase === "Running"
    ? undefined
    : "It is not running: a rolling restart would wait on members that are not up.";
}

function majority(voters: number): number {
  return Math.floor(voters / 2) + 1;
}

export function memberRestartRefusal(members: Member[], target: string): string | undefined {
  const member = members.find((each) => each.name === target);

  if (!member?.pod) return `${target} has no pod to restart.`;

  const voters = members.filter((each) => !each.extra);
  const readyAfter = voters.filter((each) => each.ready && each.name !== target).length;

  if (member.ready && readyAfter < majority(voters.length)) {
    return `Restarting ${target} now would leave ${readyAfter} of ${voters.length} members up, short of a majority.`;
  }

  return undefined;
}

/** The primary's step is marked: only then is restarting the primary intended. */
export interface RestartStep {
  member: string;
  primary: boolean;
}

/**
 * Every other member one at a time, then the primary. Its pod's SIGTERM makes it step down and hand
 * over at once; a memberConfig switch instead would leave the agents, which see the change at
 * different times, reconfiguring the set back and forth.
 */
export function restartAllPlan(
  rs: ReplicaSetLike,
  members: Member[],
): { steps: RestartStep[] } | { refused: string } {
  const current = members.filter((each) => !each.extra);

  if (rs.status?.phase !== "Running") return { refused: "It is not running." };

  const down = current.filter((each) => !each.ready);

  if (down.length > 0) {
    return {
      refused: `${down.map((each) => each.name).join(", ")} ${down.length === 1 ? "is" : "are"} not ready; restarting the others could leave no majority.`,
    };
  }

  const primary = primaryOf(current);

  if (!primary) return { refused: "Its primary could not be read from the agents." };

  if (current.some((each) => each.inGoalState === false)) {
    return { refused: "A member is still applying its last change." };
  }

  return {
    steps: [
      ...current
        .filter((each) => each !== primary)
        .map((each) => ({ member: each.name, primary: false })),
      { member: primary.name, primary: true },
    ],
  };
}

export function describeStep(step: RestartStep): string {
  return step.primary ? `restart ${step.member}, the primary` : `restart ${step.member}`;
}

export function connectionSecretOf(rs: ReplicaSetLike, user: UserSpec): string {
  return user.connectionStringSecretName ?? `${rs.getName()}-${user.db}-${user.name}`;
}

/** Runs where the terminal runs; the password stays in the shell, never in Freelens. HOME: mongosh's history needs a writable one. */
export function mongoshCommand(rs: ReplicaSetLike, member: string): string {
  const namespace = rs.getNs() ?? "default";
  const user = rs.spec.users?.[0];
  // With TLS on, mongosh needs the CA the operator mounts under a hashed name; the glob runs in the pod.
  const mongosh = rs.spec.security?.tls?.enabled
    ? `sh -c 'HOME=/tmp exec mongosh --tlsCAFile /var/lib/tls/ca/*.pem "$@"' mongosh`
    : "env HOME=/tmp mongosh";
  const exec = `kubectl exec -it -n ${namespace} ${member} -c mongod -- ${mongosh}`;

  if (!user) return exec;

  const secret = connectionSecretOf(rs, user);

  return `${exec} "$(kubectl get secret -n ${user.connectionStringSecretNamespace ?? namespace} ${secret} -o jsonpath='{.data.connectionString\\.standard}' | base64 -d)"`;
}

export function replicaSetCommands(rs: ReplicaSetLike): { label: string; command: string }[] {
  const namespace = rs.getNs() ?? "default";
  const name = rs.getName();

  return [
    {
      label: "Its status and events",
      command: `kubectl describe mongodbcommunity -n ${namespace} ${name}`,
    },
    {
      label: "Its pods",
      command: `kubectl get pods -n ${namespace} -l app=${name}-svc -o wide`,
    },
    {
      label: "What each agent is doing",
      command: `kubectl logs -n ${namespace} ${name}-0 -c mongodb-agent --tail=100`,
    },
    ...(rs.spec.users?.[0]
      ? [
          {
            label: "The full connection string, with the password",
            command: `kubectl get secret -n ${namespace} ${connectionSecretOf(rs, rs.spec.users[0])} -o jsonpath='{.data.connectionString\\.standard}' | base64 -d`,
          },
        ]
      : []),
    {
      label: "Step the primary down, from mongosh on it",
      command: "rs.stepDown()",
    },
  ];
}

/** Back from a delete: a new pod, started after it, and Ready. */
export function podBackAfter(
  pod:
    | { status?: { startTime?: string; conditions?: { type: string; status: string }[] } }
    | undefined,
  deletedAt: number,
): boolean {
  const started = Date.parse(pod?.status?.startTime ?? "");
  const ready = pod?.status?.conditions?.some(
    (each) => each.type === "Ready" && each.status === "True",
  );

  return Boolean(ready) && !Number.isNaN(started) && started >= deletedAt - 1000;
}

/** Re-checked against fresh state before each step: the plan was made from what the page showed. */
export function stepRefusal(step: RestartStep, members: Member[]): string | undefined {
  const member = members.find((each) => each.name === step.member);

  if (!member?.pod) return `${step.member} has no pod.`;

  const others = members.filter((each) => !each.extra && each.name !== step.member);

  if (others.some((each) => !each.ready)) return "Another member is not ready.";

  return member.role === "primary" && !step.primary
    ? `${step.member} became the primary; it was meant to go last.`
    : undefined;
}

/** Every member up and at its agent's goal: only then has a config change reached them all. */
export function isSettled(rs: ReplicaSetLike, members: Member[]): boolean {
  const current = members.filter((each) => !each.extra);

  return (
    rs.status?.phase === "Running" &&
    current.length > 0 &&
    current.every((each) => each.ready && each.inGoalState === true)
  );
}
