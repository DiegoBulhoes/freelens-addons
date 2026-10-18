import { currentMembers, dataMembers, isReady, type Member, primaryOf } from "../clusters/members";
import { keyOf, runningVersion } from "../clusters/replica-sets";
import type { Command } from "../shared/commands";
import type { MemberConfig, ReplicaSetLike } from "../shared/types";

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

/** The label the operator puts on every member pod, arbiters included. */
export function memberSelector(rs: ReplicaSetLike): string {
  return `app=${rs.getName()}-svc`;
}

const restartingAll = new Set<string>();

/** While Restart all runs, any other write to its members could take one more down and lose the majority. */
export function restartingRefusal(rs: ReplicaSetLike): string | undefined {
  return restartingAll.has(keyOf(rs))
    ? `Restart all is still running on ${rs.getName()}; wait for it to end.`
    : undefined;
}

export async function whileRestartingAll<T>(rs: ReplicaSetLike, run: () => Promise<T>): Promise<T> {
  const refused = restartingRefusal(rs);

  if (refused) throw new Error(refused);

  restartingAll.add(keyOf(rs));

  try {
    return await run();
  } finally {
    restartingAll.delete(keyOf(rs));
  }
}

const MAX_MEMBERS = 50;
// MongoDB counts at most seven voters.
const MAX_VOTERS = 7;

const voteOf = (entry: MemberConfig) => entry.votes ?? 1;
const votesIn = (config: MemberConfig[]) => config.map(voteOf).reduce((a, b) => a + b, 0);
const memberConfigOf = (rs: ReplicaSetLike, member: Member) =>
  rs.spec.memberConfig?.[Number(member.index)];

/** No vote or priority 0: mongod never makes it primary, and a member without a vote must keep priority 0. */
function unelectable(entry: MemberConfig | undefined): boolean {
  return entry?.votes === 0 || Number(entry?.priority ?? 1) === 0;
}

function memberConfigFor(rs: ReplicaSetLike, count: number): MemberConfig[] | undefined {
  const current = rs.spec.memberConfig;
  const arbiters = rs.spec.arbiters ?? 0;

  // Without one the operator gives every member a vote, which past seven mongod refuses.
  if (!current && count + arbiters <= MAX_VOTERS) return undefined;

  let voters = arbiters + votesIn((current ?? []).slice(0, count));

  return Array.from({ length: count }, (_, at) => {
    const entry = current?.[at];

    if (entry) return entry;
    if (voters >= MAX_VOTERS) return { votes: 0, priority: "0" };
    voters += 1;

    return { votes: 1, priority: "1" };
  });
}

export function scaleRefusal(rs: ReplicaSetLike, count: number): string | undefined {
  const restarting = restartingRefusal(rs);

  if (restarting) return restarting;
  if (!Number.isInteger(count) || count < 1) return "A cluster needs at least one member.";
  if (count > MAX_MEMBERS) return `MongoDB allows at most ${MAX_MEMBERS} members.`;
  if (count === rs.spec.members) return `It already has ${count} members.`;

  return undefined;
}

/** Said in the dialog, not refused: these are legitimate but worth a second look. */
export function scaleWarnings(rs: ReplicaSetLike, count: number): string[] {
  const warnings: string[] = [];
  const config = memberConfigFor(rs, count);
  const voters = (config ? votesIn(config) : count) + (rs.spec.arbiters ?? 0);
  const voteless = (config ?? [])
    .slice(rs.spec.members)
    .flatMap((entry, at) => (entry.votes === 0 ? [`${rs.getName()}-${rs.spec.members + at}`] : []));

  if (voters % 2 === 0) {
    warnings.push(
      `${voters} voting members can split evenly: an election may find no majority. An odd number, or an arbiter, avoids it.`,
    );
  }

  if (voteless.length > 0) {
    warnings.push(
      `MongoDB counts at most ${MAX_VOTERS} voters, so these join without a vote and never become primary: ${voteless.join(", ")}.`,
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

/** What the dialog shows under its field as the count is typed. */
export function scaleAdvice(
  rs: ReplicaSetLike,
  typed: string,
): { count: number; refused?: string; warnings: string[] } {
  const count = Number(typed.trim());
  const refused = scaleRefusal(rs, count);

  return { count, refused, warnings: refused ? [] : scaleWarnings(rs, count) };
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
  const restarting = restartingRefusal(rs);

  if (restarting) return restarting;
  if (rs.status?.phase !== "Running") return "Only a running cluster can elect a new primary.";
  if (!member || member.arbiter || member.extra) return `${target} is not a data member.`;
  if (unelectable(memberConfigOf(rs, member))) {
    return `${target} has no vote or priority 0: it is set never to become primary.`;
  }
  if (member.role === undefined) return `${target}'s role could not be read from its agent.`;
  if (member.role === "primary") return `${target} is already the primary.`;
  if (!member.ready || member.role !== "secondary") return `${target} is not a ready secondary.`;
  if (!primaryOf(members)) return "There is no primary to step down.";
  if (currentMembers(members).some((each) => each.inGoalState === false)) {
    return "A member is still applying its last change; electing now would make members take the primary from each other.";
  }

  return undefined;
}

/** The member a switch elects: the one asked for, else the first that can be; else why none can. */
export function switchTarget(
  rs: ReplicaSetLike,
  members: Member[],
  to?: string,
): { target: string; candidates: string[] } | { refused: string } {
  const data = dataMembers(members);
  const candidates = data
    .filter((each) => !switchRefusal(rs, members, each.name))
    .map((each) => each.name);
  const target = to ?? candidates[0];

  if (target) {
    const refused = switchRefusal(rs, members, target);

    return refused ? { refused } : { target, candidates };
  }

  const [first] = data
    .filter((each) => each.role !== "primary")
    .map((each) => switchRefusal(rs, members, each.name));

  return { refused: first ?? "It has no other data member to elect." };
}

/** Offered from a member's row: a secondary that may ever be primary; passing refusals are said on click. */
export function offersSwitch(rs: ReplicaSetLike, member: Member): boolean {
  return (
    !member.arbiter &&
    !member.extra &&
    member.role === "secondary" &&
    !unelectable(memberConfigOf(rs, member))
  );
}

/** The set as it is at OK, not as the dialog showed it. */
export interface FreshState {
  rs: ReplicaSetLike;
  members: Member[];
}

/** Built on the set read at OK; its resourceVersion makes a change since then a conflict. */
export function checkedSwitchPatch(fresh: FreshState, target: string) {
  const refused = switchRefusal(fresh.rs, fresh.members, target);

  if (refused) throw new Error(refused);

  return {
    metadata: { resourceVersion: fresh.rs.metadata.resourceVersion },
    ...switchPatch(fresh.rs, fresh.members, target),
  };
}

/** The majority as it is at OK: another member may have gone down while the name was typed. */
export function checkMemberRestart(fresh: FreshState, target: string): void {
  const refused = memberRestartRefusal(fresh.rs, fresh.members, target);

  if (refused) throw new Error(refused);
}

/** The target outranks every other member, so it calls an election and wins it; a member set never to be primary stays so. */
export function switchPatch(rs: ReplicaSetLike, members: Member[], target: string) {
  const count = rs.spec.members;
  const current = memberConfigFor(rs, count) ?? [];
  const index = members.find((each) => each.name === target)?.index ?? -1;

  return {
    spec: {
      memberConfig: Array.from({ length: count }, (_, at) => ({
        ...current[at],
        votes: current[at]?.votes ?? 1,
        priority: at === index ? "2" : unelectable(current[at]) ? "0" : "1",
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
  const restarting = restartingRefusal(rs);

  if (restarting) return restarting;

  return rs.status?.phase === "Running"
    ? undefined
    : "It is not running: a rolling restart would wait on members that are not up.";
}

function majority(voters: number): number {
  return Math.floor(voters / 2) + 1;
}

export function memberRestartRefusal(
  rs: ReplicaSetLike,
  members: Member[],
  target: string,
): string | undefined {
  const member = members.find((each) => each.name === target);
  const restarting = restartingRefusal(rs);

  if (restarting) return restarting;
  if (!member?.pod) return `${target} has no pod to restart.`;

  const voters = currentMembers(members);
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
  const current = currentMembers(members);
  const restarting = restartingRefusal(rs);

  if (restarting) return { refused: restarting };
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

/** The primary, else a ready data member: mongosh on a secondary still reads, and says who is primary. */
export function mongoshTarget(members: Member[]): string | undefined {
  return (primaryOf(members) ?? dataMembers(members).find((each) => each.ready))?.name;
}

export interface Connection {
  namespace: string;
  name: string;
}

/** Runs where the terminal runs; the password stays in the shell, never in Freelens. HOME: mongosh's history needs a writable one. */
export function mongoshCommand(
  rs: ReplicaSetLike,
  member: string,
  connection: Connection | undefined,
): string {
  const namespace = rs.getNs() ?? "default";
  // With TLS on, mongosh needs the CA the operator mounts under a hashed name; the glob runs in the pod.
  const mongosh = rs.spec.security?.tls?.enabled
    ? `sh -c 'HOME=/tmp exec mongosh --tlsCAFile /var/lib/tls/ca/*.pem "$@"' mongosh`
    : "env HOME=/tmp mongosh";
  const exec = `kubectl exec -it -n ${namespace} ${member} -c mongod -- ${mongosh}`;

  if (!connection) return exec;

  return `${exec} "$(${connectionStringCommand(connection)})"`;
}

function connectionStringCommand(connection: Connection): string {
  return `kubectl get secret -n ${connection.namespace} ${connection.name} -o jsonpath='{.data.connectionString\\.standard}' | base64 -d`;
}

// Kustomize and Helm installs name the operator's Deployment and namespace differently; its image is the same.
const OPERATOR_IMAGE = "/mongodb-kubernetes(-operator)?[:@]";
const FIND_OPERATOR = `kubectl get deployments -A --no-headers -o 'custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,IMAGES:.spec.template.spec.containers[*].image' | awk '$3 ~ /\\${OPERATOR_IMAGE}/ { print "-n", $1, "deploy/" $2; exit }'`;

export function replicaSetCommands(
  rs: ReplicaSetLike,
  connection: Connection | undefined,
): Command[] {
  const namespace = rs.getNs() ?? "default";
  const name = rs.getName();

  return [
    {
      label: "Its status and events",
      command: `kubectl describe mongodbcommunity -n ${namespace} ${name}`,
    },
    {
      label: "Its pods",
      command: `kubectl get pods -n ${namespace} -l ${memberSelector(rs)} -o wide`,
    },
    {
      label: "What each member's agent is doing",
      command: `kubectl logs -n ${namespace} -l ${memberSelector(rs)} -c mongodb-agent --prefix --tail=50`,
    },
    {
      label: "Where the operator runs, found by its image",
      command: `kubectl get deployments -A -o wide | grep -E '${OPERATOR_IMAGE}'`,
    },
    {
      label: "The operator's log for it, wherever the operator runs",
      command: `${FIND_OPERATOR} | xargs kubectl logs | grep -F '${namespace}/${name}'`,
    },
    ...(connection
      ? [
          {
            label: "The full connection string, with the password",
            command: connectionStringCommand(connection),
          },
        ]
      : []),
    {
      label: "Step the primary down, from mongosh on it",
      command: "rs.stepDown()",
    },
  ];
}

/** Back from a delete: another pod by that name, told by its uid since the server's clock is not ours, and Ready. */
export function podReplaced(
  pod:
    | {
        metadata?: { uid?: string };
        status?: { conditions?: { type: string; status: string }[] };
      }
    | undefined,
  before: string | undefined,
): boolean {
  const uid = pod?.metadata?.uid;

  return isReady(pod) && before !== undefined && uid !== undefined && uid !== before;
}

/** Re-checked against fresh state before each step: the plan was made from what the page showed. */
export function stepRefusal(step: RestartStep, members: Member[]): string | undefined {
  const member = members.find((each) => each.name === step.member);

  // Without its uid the new pod could not be told from the old one.
  if (!member?.pod?.metadata.uid) return `${step.member} has no pod.`;

  const others = currentMembers(members).filter((each) => each.name !== step.member);

  if (others.some((each) => !each.ready)) return "Another member is not ready.";

  return member.role === "primary" && !step.primary
    ? `${step.member} became the primary; it was meant to go last.`
    : undefined;
}

/** Every member up and at its agent's goal: only then has a config change reached them all. */
export function isSettled(rs: ReplicaSetLike, members: Member[]): boolean {
  const current = currentMembers(members);

  return (
    rs.status?.phase === "Running" &&
    current.length > 0 &&
    current.every((each) => each.ready && each.inGoalState === true)
  );
}
