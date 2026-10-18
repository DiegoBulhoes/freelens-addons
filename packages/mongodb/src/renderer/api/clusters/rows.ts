import {
  matchesReplicaSetFilter,
  REPLICA_SET_FILTERS,
  type ReplicaSetCounts,
  type ReplicaSetFilter,
} from "../shared/navigation";
import { type LoadState, type PodsRead, podsReadIn } from "../shared/store-state";
import type { PodLike, PvcLike, ReplicaSetLike } from "../shared/types";
import { plural, RANK, type Verdict } from "../shared/verdict";
import { type AgentView, agentKeys } from "./agent";
import { type Member, membersOf } from "./members";
import { keyOf, replicaSetHealth } from "./replica-sets";
import { type SecretNames, type TlsView, tlsOf, type UserView, usersOf } from "./upkeep";

export interface Inventory {
  replicaSets: ReplicaSetLike[];
  pods: PodLike[];
  podsRead: PodsRead;
  /** Namespaces whose pods were refused. */
  podsFailed?: ReadonlySet<string>;
  pvcs: PvcLike[];
  /** Undefined until listed. */
  secrets?: SecretNames;
  agents: Record<string, AgentView | undefined>;
}

export interface ReplicaSetRow {
  rs: ReplicaSetLike;
  members: Member[];
  health: Verdict;
  /** Its namespace's pods, as the verdict read them. */
  podsRead: PodsRead;
  users: UserView[];
  tls: TlsView;
}

/** Agents are keyed "namespace/pod". */
export function agentsOf(
  rs: ReplicaSetLike,
  agents: Record<string, AgentView | undefined>,
): Record<string, AgentView | undefined> {
  const prefix = `${rs.getNs()}/`;

  return Object.fromEntries(
    Object.entries(agents)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, view]) => [key.slice(prefix.length), view]),
  );
}

/** Pods of a cluster only: "<name>-<n>" or "<name>-arb-<n>", in its namespace. */
export function memberPodsOf(replicaSets: ReplicaSetLike[], pods: PodLike[]): PodLike[] {
  const names = new Set(replicaSets.map(keyOf));

  return pods.filter((pod) =>
    names.has(`${pod.getNs()}/${pod.getName().replace(/(-arb)?-\d+$/, "")}`),
  );
}

/** "namespace/pod" of the sets' members whose agent can be read: no exec into another set's pods or a pod not started. */
export function agentTargetsOf(replicaSets: ReplicaSetLike[], pods: PodLike[]): string[] {
  return agentKeys(memberPodsOf(replicaSets, pods));
}

export function describeMissingTls(missing: string[]): string {
  return missing.length === 1
    ? `Its TLS Secret ${missing[0]} does not exist`
    : `Its TLS Secrets ${missing.join(" and ")} do not exist`;
}

/** No member up and a TLS Secret missing: the operator starts none without it, so that is the cause. */
function withTlsCause(health: Verdict, tls: TlsView): Verdict {
  if (health.label !== "Down" || tls.missing.length === 0) return health;

  return {
    ...health,
    reason: `${describeMissingTls(tls.missing)}, so the operator starts no member.`,
  };
}

function replicaSetRow(rs: ReplicaSetLike, inventory: Inventory): ReplicaSetRow {
  const podsRead = podsReadIn(inventory.podsRead, inventory.podsFailed, rs.getNs());
  const members = membersOf(
    rs,
    inventory.pods,
    inventory.pvcs,
    agentsOf(rs, inventory.agents),
    podsRead === "read",
  );
  const tls = tlsOf(rs, inventory.secrets);

  return {
    rs,
    members,
    health: withTlsCause(replicaSetHealth(rs, members, podsRead), tls),
    podsRead,
    users: usersOf(rs, inventory.secrets),
    tls,
  };
}

/** Worst first, then by name. */
export function replicaSetRows(inventory: Inventory): ReplicaSetRow[] {
  return inventory.replicaSets
    .map((rs) => replicaSetRow(rs, inventory))
    .sort(
      (a, b) =>
        RANK[a.health.tone] - RANK[b.health.tone] || a.rs.getName().localeCompare(b.rs.getName()),
    );
}

export interface AttentionItem {
  kind: "Cluster" | "User" | "Secret";
  name: string;
  replicaSet: string;
  namespace: string;
  verdict: Verdict;
}

function healthAttention(row: ReplicaSetRow): AttentionItem[] {
  // A read still under way is no verdict yet; a refused one is.
  if (row.health.tone === "ok" || (row.podsRead === "reading" && row.health.tone === "info")) {
    return [];
  }

  const replicaSet = row.rs.getName();

  return [
    {
      kind: "Cluster",
      name: replicaSet,
      replicaSet,
      namespace: row.rs.getNs() ?? "",
      verdict: row.health,
    },
  ];
}

function passwordAttention(row: ReplicaSetRow): AttentionItem[] {
  return row.users.flatMap((view) => {
    const secret = view.user.passwordSecretRef?.name ?? "";

    // The operator's own failure already names this Secret.
    if (view.hasPassword || row.rs.status?.message?.includes(secret)) return [];

    return [
      {
        kind: "User",
        name: view.user.name,
        replicaSet: row.rs.getName(),
        namespace: row.rs.getNs() ?? "",
        verdict: {
          tone: "critical",
          label: "No password",
          reason: `Its password Secret ${secret} does not exist, so the operator cannot create the user.`,
        },
      },
    ];
  });
}

function tlsAttention(row: ReplicaSetRow): AttentionItem[] {
  if (
    row.tls.missing.length === 0 ||
    row.tls.missing.some((each) => row.health.reason.includes(each))
  ) {
    return [];
  }

  return [
    {
      kind: "Secret",
      name: row.tls.missing.join(", "),
      replicaSet: row.rs.getName(),
      namespace: row.rs.getNs() ?? "",
      verdict: {
        tone: "critical",
        label: "No TLS Secret",
        reason: `${describeMissingTls(row.tls.missing)}: the operator cannot reconcile the cluster meanwhile.`,
      },
    },
  ];
}

/** Worst first; within a tone, in the clusters' order. */
export function attentionItems(rows: ReplicaSetRow[]): AttentionItem[] {
  return rows
    .flatMap((row) => [...healthAttention(row), ...passwordAttention(row), ...tlsAttention(row)])
    .sort((a, b) => RANK[a.verdict.tone] - RANK[b.verdict.tone]);
}

/** Each filter's count is the number of rows it keeps, so a card and the list it opens agree. */
export function countsOf(rows: ReplicaSetRow[]): ReplicaSetCounts {
  return {
    replicaSets: rows.length,
    ...(Object.fromEntries(
      REPLICA_SET_FILTERS.map((filter) => [
        filter,
        rows.filter((row) => matchesReplicaSetFilter(row, filter)).length,
      ]),
    ) as Record<ReplicaSetFilter, number>),
  };
}

export function describeHeadline(needing: number, total: number, state: LoadState): string {
  // Before the clusters are read, none is not yet "no clusters".
  if (total === 0) return state === "ready" ? "No MongoDB clusters" : "MongoDB clusters";
  if (needing === 0) return `${plural(total, "cluster")}, all healthy`;

  return `${needing} of ${plural(total, "cluster")} need${needing === 1 ? "s" : ""} attention`;
}
