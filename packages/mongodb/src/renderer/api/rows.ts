import type { AgentView } from "./agent";
import { type Member, membersOf } from "./members";
import { isChangingVersion, replicaSetHealth } from "./replica-sets";
import type { PodLike, PvcLike, ReplicaSetLike, SecretMetaLike } from "./types";
import { type TlsView, tlsOf, type UserView, usersOf } from "./upkeep";
import { RANK, type Verdict } from "./verdict";

export interface Inventory {
  replicaSets: ReplicaSetLike[];
  pods: PodLike[];
  pvcs: PvcLike[];
  /** Undefined until listed. */
  secrets?: SecretMetaLike[];
  agents: Record<string, AgentView | undefined>;
}

export interface ReplicaSetRow {
  rs: ReplicaSetLike;
  members: Member[];
  health: Verdict;
  users: UserView[];
  tls: TlsView;
}

export const keyOf = (rs: { getNs(): string | undefined; getName(): string }) =>
  `${rs.getNs()}/${rs.getName()}`;

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

/** Worst first, then by name. */
export function replicaSetRows(inventory: Inventory): ReplicaSetRow[] {
  return inventory.replicaSets
    .map((rs) => {
      const members = membersOf(rs, inventory.pods, inventory.pvcs, agentsOf(rs, inventory.agents));

      return {
        rs,
        members,
        health: replicaSetHealth(rs, members),
        users: usersOf(rs, inventory.secrets),
        tls: tlsOf(rs, inventory.secrets),
      };
    })
    .sort(
      (a, b) =>
        RANK[a.health.tone] - RANK[b.health.tone] || a.rs.getName().localeCompare(b.rs.getName()),
    );
}

export interface AttentionItem {
  kind: "Cluster" | "User";
  name: string;
  replicaSet: string;
  namespace: string;
  verdict: Verdict;
}

export function attentionItems(rows: ReplicaSetRow[]): AttentionItem[] {
  return rows.flatMap((row) => {
    const replicaSet = row.rs.getName();
    const namespace = row.rs.getNs() ?? "";
    const items: AttentionItem[] = [];

    if (row.health.tone !== "ok") {
      items.push({
        kind: "Cluster",
        name: replicaSet,
        replicaSet,
        namespace,
        verdict: row.health,
      });
    }

    for (const view of row.users) {
      const secret = view.user.passwordSecretRef?.name ?? "";

      // The operator's own failure already names this Secret.
      if (view.hasPassword || row.rs.status?.message?.includes(secret)) continue;

      items.push({
        kind: "User",
        name: view.user.name,
        replicaSet,
        namespace,
        verdict: {
          tone: "critical",
          label: "No password",
          reason: `Its password Secret ${secret} does not exist, so the operator cannot create the user.`,
        },
      });
    }

    return items;
  });
}

export function countsOf(rows: ReplicaSetRow[]) {
  return {
    replicaSets: rows.length,
    down: rows.filter((row) => row.health.tone === "critical").length,
    degraded: rows.filter((row) => row.health.tone === "warning").length,
    changingVersion: rows.filter((row) => isChangingVersion(row.rs)).length,
    usersWithoutPassword: rows.flatMap((row) => row.users).filter((view) => !view.hasPassword)
      .length,
  };
}

export function describeHeadline(needing: number, total: number): string {
  if (total === 0) return "No MongoDB clusters";
  if (needing === 0) return `${total} cluster${total === 1 ? "" : "s"}, all healthy`;

  return `${needing} of ${total} cluster${total === 1 ? "" : "s"} need${needing === 1 ? "s" : ""} attention`;
}
