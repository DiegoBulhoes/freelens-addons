import type { ClusterLike, Condition } from "./types";

export type Tone = "critical" | "warning" | "info" | "ok";

export interface Verdict {
  tone: Tone;
  label: string;
  reason: string;
}

export const RANK: Record<Tone, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

export function worse(a: Verdict, b: Verdict): Verdict {
  return RANK[b.tone] < RANK[a.tone] ? b : a;
}

export const HEALTHY_PHASE = "Cluster in healthy state";
export const HIBERNATION_ANNOTATION = "cnpg.io/hibernation";
const HIBERNATION_CONDITION = "cnpg.io/hibernation";

export function conditionOf(cluster: ClusterLike, type: string): Condition | undefined {
  return cluster.status?.conditions?.find((condition) => condition.type === type);
}

// The phase stays "healthy" while hibernated; only the annotation and its condition say so.
export function isHibernated(cluster: ClusterLike): boolean {
  return (
    cluster.metadata.annotations?.[HIBERNATION_ANNOTATION] === "on" ||
    conditionOf(cluster, HIBERNATION_CONDITION)?.status === "True"
  );
}

export function readyCount(cluster: ClusterLike): { ready: number; wanted: number } {
  return { ready: cluster.status?.readyInstances ?? 0, wanted: cluster.spec.instances };
}

export function clusterHealth(cluster: ClusterLike): Verdict {
  const status = cluster.status;
  const phase = status?.phase ?? "Unknown";
  const { ready, wanted } = readyCount(cluster);

  if (isHibernated(cluster)) {
    return {
      tone: "info",
      label: "Hibernated",
      reason: "Its pods are stopped and its volumes kept. Wake it to use it.",
    };
  }

  if (conditionOf(cluster, "Ready")?.status !== "True") {
    return {
      tone: "critical",
      label: "Not ready",
      reason: status?.phaseReason ? `${phase}: ${status.phaseReason}` : phase,
    };
  }

  if (phase !== HEALTHY_PHASE) {
    return { tone: "warning", label: phase, reason: status?.phaseReason ?? phase };
  }

  if (ready < wanted) {
    return {
      tone: "warning",
      label: "Degraded",
      reason: `${ready} of ${wanted} instances are ready.`,
    };
  }

  return {
    tone: "ok",
    label: "Healthy",
    reason: `${wanted} instance${wanted === 1 ? "" : "s"} ready, primary ${status?.currentPrimary ?? "unknown"}.`,
  };
}

export type Role = "primary" | "replica" | "promoting";

export interface InstanceRow {
  name: string;
  role: Role;
  healthy: boolean;
  timeline?: number;
}

/** None while hibernated: the operator keeps their names, not their pods. */
export function instancesOf(cluster: ClusterLike): InstanceRow[] {
  if (isHibernated(cluster)) return [];

  const status = cluster.status;
  const healthy = new Set(status?.instancesStatus?.healthy ?? []);
  const reported = status?.instancesReportedState ?? {};

  const order: Record<Role, number> = { primary: 0, promoting: 1, replica: 2 };

  return (status?.instanceNames ?? [])
    .map(
      (name): InstanceRow => ({
        name,
        role:
          name === status?.currentPrimary
            ? "primary"
            : name === status?.targetPrimary
              ? "promoting"
              : "replica",
        healthy: healthy.has(name),
        timeline: reported[name]?.timeLineID,
      }),
    )
    .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
}

/** Every replica, healthy or not; the primary and an instance being promoted are not. */
export function replicaNames(cluster: ClusterLike): string[] {
  return instancesOf(cluster)
    .filter((instance) => instance.role === "replica")
    .map((instance) => instance.name);
}

export function replicasOf(cluster: ClusterLike): string[] {
  return instancesOf(cluster)
    .filter((instance) => instance.role === "replica" && instance.healthy)
    .map((instance) => instance.name);
}

export function lastSwitchover(cluster: ClusterLike): string | undefined {
  const timeline = cluster.status?.timelineID ?? 1;

  // Timeline 1 is the bootstrap; each promotion starts a new one.
  return timeline > 1 ? cluster.status?.currentPrimaryTimestamp : undefined;
}

/** The Postgres version, from the image tag ("18.4-system-trixie"), else the data's major version. */
export function postgresVersion(cluster: ClusterLike): string | undefined {
  const image =
    cluster.status?.image ?? cluster.spec.imageName ?? cluster.status?.pgDataImageInfo?.image;
  const tag = /:(\d+(?:\.\d+)?)(?:[-@]|$)/.exec(image ?? "")?.[1];
  const major = cluster.status?.pgDataImageInfo?.majorVersion;

  return tag ?? (major === undefined ? undefined : String(major));
}
