import { dataMembers, type Member, primaryOf, readyCount } from "./members";
import type { ReplicaSetLike } from "./types";
import type { Verdict } from "./verdict";

export const LAST_APPLIED_VERSION = "mongodb.com/v1.lastAppliedMongoDBVersion";

/** What it runs: the status once reached, else the last version the operator applied. */
export function runningVersion(rs: ReplicaSetLike): string | undefined {
  return rs.status?.version || rs.metadata.annotations?.[LAST_APPLIED_VERSION] || undefined;
}

export function isChangingVersion(rs: ReplicaSetLike): boolean {
  return runningVersion(rs) !== rs.spec.version;
}

function firstProblem(members: Member[]): string | undefined {
  return members.find((each) => each.problem)?.problem;
}

export function replicaSetHealth(rs: ReplicaSetLike, members: Member[]): Verdict {
  const phase = rs.status?.phase;
  const { ready, wanted } = readyCount(rs, members);
  const problem = firstProblem(members);

  if (phase === "Failed") {
    return {
      tone: "critical",
      label: "Failed",
      reason: rs.status?.message ?? problem ?? "The operator gave up on it.",
    };
  }

  if (ready === 0 && wanted > 0) {
    return {
      tone: "critical",
      label: "Down",
      reason: problem ?? rs.status?.message ?? "No member is ready.",
    };
  }

  if (isChangingVersion(rs) && phase !== "Running") {
    return {
      tone: "warning",
      label: "Changing version",
      reason: `Asked for ${rs.spec.version}, still on ${runningVersion(rs) ?? "an unknown version"}.${problem ? ` ${problem}` : ""}`,
    };
  }

  if (ready < wanted) {
    return {
      tone: "warning",
      label: "Degraded",
      reason: `${ready} of ${wanted} members ready.${problem ? ` ${problem}` : ""}`,
    };
  }

  const knownRoles = dataMembers(members).some((each) => each.role !== undefined);

  if (knownRoles && !primaryOf(members)) {
    return {
      tone: "critical",
      label: "No primary",
      reason: "Every member is up, but none is primary: writes are refused.",
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

export function versionLabel(rs: ReplicaSetLike): string {
  const running = runningVersion(rs);
  const fcv = rs.spec.featureCompatibilityVersion;
  const base = running ?? "—";
  const target = isChangingVersion(rs) ? ` → ${rs.spec.version}` : "";

  return `${base}${target}${fcv ? ` (FCV ${fcv})` : ""}`;
}
