import type { PodsRead } from "../shared/store-state";
import type { ReplicaSetLike } from "../shared/types";
import type { Verdict } from "../shared/verdict";
import { dataMembers, type Member, primaryOf, readyCount } from "./members";

export const LAST_APPLIED_VERSION = "mongodb.com/v1.lastAppliedMongoDBVersion";

export const keyOf = (rs: { getNs(): string | undefined; getName(): string }) =>
  `${rs.getNs()}/${rs.getName()}`;

/** What it runs: the status once reached, else the last version the operator applied. */
export function runningVersion(rs: ReplicaSetLike): string | undefined {
  return rs.status?.version || rs.metadata.annotations?.[LAST_APPLIED_VERSION] || undefined;
}

/** From a version it runs to another; a set that never ran is not changing, only not there yet. */
export function versionChange(rs: ReplicaSetLike): { from: string; to: string } | undefined {
  const from = runningVersion(rs);

  return from && from !== rs.spec.version ? { from, to: rs.spec.version } : undefined;
}

export function isChangingVersion(rs: ReplicaSetLike): boolean {
  return versionChange(rs) !== undefined;
}

function firstProblem(members: Member[]): string | undefined {
  return members.find((each) => each.problem)?.problem;
}

export function replicaSetHealth(
  rs: ReplicaSetLike,
  members: Member[],
  pods: PodsRead = "read",
): Verdict {
  const phase = rs.status?.phase;
  const { ready, wanted } = readyCount(rs, members);
  const problem = firstProblem(members);
  const change = versionChange(rs);

  if (phase === "Failed") {
    return {
      tone: "critical",
      label: "Failed",
      reason: rs.status?.message ?? problem ?? "The operator gave up on it.",
    };
  }

  if (pods !== "read") {
    return {
      tone: "info",
      label: "Members unknown",
      reason:
        pods === "refused"
          ? "Its pods could not be read, so its members cannot be judged."
          : "Its pods are still being read.",
    };
  }

  if (ready === 0 && wanted > 0) {
    return {
      tone: "critical",
      label: "Down",
      reason: problem ?? rs.status?.message ?? "No member is ready.",
    };
  }

  if (change && phase !== "Running") {
    return {
      tone: "warning",
      label: "Changing version",
      reason: `Asked for ${change.to}, still on ${change.from}.${problem ? ` ${problem}` : ""}`,
    };
  }

  if (ready < wanted) {
    return {
      tone: "warning",
      label: "Degraded",
      reason: `${ready} of ${wanted} members ready.${problem ? ` ${problem}` : ""}`,
    };
  }

  // Every data member is ready here: fewer returned Degraded above.
  const data = dataMembers(members);
  const unread = data.filter((each) => each.role === undefined).length;

  // With no role read at all the agents' error says so; one unread role may be the primary.
  if (unread < data.length && !primaryOf(members)) {
    return unread === 0
      ? {
          tone: "critical",
          label: "No primary",
          reason: "Every member is up, but none is primary: writes are refused.",
        }
      : {
          tone: "info",
          label: "Primary unknown",
          reason: `${unread} of ${data.length} members' roles could not be read, and none of the others is primary.`,
        };
  }

  if (phase !== "Running") {
    return {
      tone: "info",
      label: phase ?? "Starting",
      reason: rs.status?.message ?? "The operator has not finished with it yet.",
    };
  }

  return { tone: "ok", label: "Healthy", reason: `${ready} of ${wanted} members ready.` };
}

export function versionOrder(rs: ReplicaSetLike): number {
  const [major = 0, minor = 0, patch = 0] = (runningVersion(rs) ?? "").split(".").map(Number);

  return major * 1_000_000 + minor * 1000 + patch;
}

export function versionLabel(rs: ReplicaSetLike): string {
  const running = runningVersion(rs);
  const fcv = rs.spec.featureCompatibilityVersion;
  const change = versionChange(rs);
  const base = change
    ? `${change.from} → ${change.to}`
    : (running ?? `${rs.spec.version} not reached yet`);

  return `${base}${fcv ? ` (FCV ${fcv})` : ""}`;
}
