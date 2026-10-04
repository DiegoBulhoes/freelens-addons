import type { Tone, Verdict } from "./clusters";
import type { ClusterLike, PodDisruptionBudgetLike, PodLike } from "./types";

export interface RoleRow {
  name: string;
  state: string;
  tone: Tone;
  error?: string;
}

// The operator's own roles are listed as reserved; they are not the user's to manage.
export function managedRoles(cluster: ClusterLike): RoleRow[] {
  const status = cluster.status?.managedRolesStatus;
  const errors = status?.cannotReconcile ?? {};
  const rows: RoleRow[] = [];

  for (const [state, names] of Object.entries(status?.byStatus ?? {})) {
    if (state === "reserved") continue;

    for (const name of names) {
      const error = errors[name]?.join(" ");

      rows.push({
        name,
        state,
        tone: error
          ? "critical"
          : state === "reconciled" || state === "not-managed"
            ? "ok"
            : "warning",
        error,
      });
    }
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface TablespaceRow {
  name: string;
  owner?: string;
  state: string;
  tone: Tone;
  error?: string;
}

export function tablespaces(cluster: ClusterLike): TablespaceRow[] {
  return (cluster.status?.tablespacesStatus ?? []).map((tablespace) => ({
    name: tablespace.name,
    owner: tablespace.owner,
    state: tablespace.state ?? "unknown",
    tone: tablespace.error ? "critical" : tablespace.state === "reconciled" ? "ok" : "warning",
    error: tablespace.error,
  }));
}

/** Roles and tablespaces the operator could not apply, for the attention list. */
export function declaredIssues(cluster: ClusterLike): Verdict[] {
  return [
    ...managedRoles(cluster)
      .filter((role) => role.tone !== "ok")
      .map(
        (role): Verdict => ({
          tone: role.tone,
          label: "Role not applied",
          reason: `${role.name}: ${role.error ?? role.state}`,
        }),
      ),
    ...tablespaces(cluster)
      .filter((tablespace) => tablespace.tone !== "ok")
      .map(
        (tablespace): Verdict => ({
          tone: tablespace.tone,
          label: "Tablespace not applied",
          reason: `${tablespace.name}: ${tablespace.error ?? tablespace.state}`,
        }),
      ),
  ];
}

export interface Maintenance {
  inProgress: boolean;
  reusePVC: boolean;
}

// The operator's defaults: no window open, and volumes reused when a node comes back.
export function maintenanceOf(cluster: ClusterLike): Maintenance {
  return {
    inProgress: cluster.spec.nodeMaintenanceWindow?.inProgress === true,
    reusePVC: cluster.spec.nodeMaintenanceWindow?.reusePVC !== false,
  };
}

export function maintenancePatch(window: Maintenance) {
  return {
    spec: { nodeMaintenanceWindow: { inProgress: window.inProgress, reusePVC: window.reusePVC } },
  };
}

export interface PlacedInstance {
  node?: string;
  qos?: string;
}

export function placementOf(
  pods: PodLike[],
  namespace: string | undefined,
  instance: string,
): PlacedInstance {
  const pod = pods.find((each) => each.getNs() === namespace && each.getName() === instance);

  return { node: pod?.spec?.nodeName, qos: pod?.status?.qosClass };
}

export interface BudgetRow {
  name: string;
  expected: number;
  healthy: number;
  desired: number;
  allowed: number;
  tone: Tone;
}

export function budgetsOf(cluster: ClusterLike, budgets: PodDisruptionBudgetLike[]): BudgetRow[] {
  return budgets
    .filter(
      (budget) =>
        budget.getNs() === cluster.getNs() &&
        budget.metadata.labels?.["cnpg.io/cluster"] === cluster.getName(),
    )
    .map((budget) => {
      const status = budget.status ?? {};
      const healthy = status.currentHealthy ?? 0;
      const desired = status.desiredHealthy ?? 0;

      return {
        name: budget.getName(),
        expected: status.expectedPods ?? 0,
        healthy,
        desired,
        allowed: status.disruptionsAllowed ?? 0,
        tone: healthy < desired ? ("warning" as const) : ("ok" as const),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
