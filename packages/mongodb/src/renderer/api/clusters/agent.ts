import { FRESH_MS } from "../shared/polling";
import type { AgentHealth, AgentPlan, PodLike } from "../shared/types";

export const AGENT_CONTAINER = "mongodb-agent";
export const HEALTH_FILE = "/var/log/mongodb-mms-automation/healthstatus/agent-health-status.json";

export type ReplicationRole =
  | "primary"
  | "secondary"
  | "arbiter"
  | "starting"
  | "recovering"
  | "down"
  | "not running"
  | "unknown";

// MongoDB's member states; -1 is the agent's own "mongod is not running".
const ROLES: Record<number, ReplicationRole> = {
  [-1]: "not running",
  0: "starting",
  1: "primary",
  2: "secondary",
  3: "recovering",
  5: "starting",
  6: "unknown",
  7: "arbiter",
  8: "down",
  9: "recovering",
  10: "down",
};

export interface AgentView {
  role: ReplicationRole;
  inGoalState: boolean;
  /** Why the member has not reached its goal; only when it has not. */
  stuck?: string;
}

function tidy(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** The step of the newest unfinished plan that holds it: a failed one first, else the one waiting. */
export function stuckAt(plans: AgentPlan[] | null | undefined): string | undefined {
  const plan = (plans ?? []).at(-1);

  if (!plan || plan.completed) return undefined;

  const steps = (plan.moves ?? []).flatMap((move) =>
    (move.steps ?? []).map((step) => ({ move, step })),
  );
  const failed = steps.find(({ step }) => step.result === "error");
  const waiting = steps.find(({ step }) => step.started && !step.completed);
  const found = failed ?? waiting;

  if (!found) return undefined;

  const what = tidy(found.step.stepDoc) || found.step.step;

  return failed ? `${what}: the agent's last attempt failed.` : `${what}: waiting.`;
}

export function agentViewOf(health: AgentHealth | undefined, pod: string): AgentView | undefined {
  const status = health?.statuses?.[pod];

  if (!status) return undefined;

  const inGoalState = status.IsInGoalState === true;

  return {
    role: ROLES[status.ReplicationStatus ?? 6] ?? "unknown",
    inGoalState,
    // Old plans keep a failed step after the member recovered: only a member short of its goal has a cause.
    stuck: inGoalState ? undefined : stuckAt(health?.mmsStatus?.[pod]?.plans),
  };
}

/** "namespace/pod" of each pod whose agent runs: a member whose mongod cannot start still has one. */
export function agentKeys(pods: PodLike[]): string[] {
  return pods
    .filter((pod) =>
      pod.status?.containerStatuses?.some(
        (each) => each.name === AGENT_CONTAINER && each.state?.running,
      ),
    )
    .map((pod) => `${pod.getNs()}/${pod.getName()}`);
}

/** One agent's last read: `failed` marks a read that did not answer, `view` stays the last that did. */
export interface AgentRead {
  /** When the last read ended; undefined before the first. */
  at?: number;
  view?: AgentView;
  failed?: string;
  /** When the current run of failed reads began. */
  failedSince?: number;
  inFlight?: boolean;
}

/** How long a failing agent's last view still stands for its member's role. */
export const KEPT_VIEW_MS = 3 * FRESH_MS;

/** Keeps what the last read said while the next one is under way. */
export function startAgentRead(before: AgentRead | undefined): AgentRead {
  return { ...before, inFlight: true };
}

export type AgentReadOutcome = { view: AgentView | undefined } | { failed: string };

/** A failed read keeps the last view for a while: one lost exec must not blank a role, a lasting failure must not pin a stale one. */
export function afterAgentRead(
  before: AgentRead | undefined,
  at: number,
  outcome: AgentReadOutcome,
): AgentRead {
  if (!("failed" in outcome)) return { at, view: outcome.view };

  const failedSince = before?.failed ? (before.failedSince ?? at) : at;

  return {
    at,
    view: at - failedSince < KEPT_VIEW_MS ? before?.view : undefined,
    failed: outcome.failed,
    failedSince,
  };
}

/** Why the agents could not be read, only when none of them could. */
export function agentsError(reads: (AgentRead | undefined)[]): string | undefined {
  return reads.length > 0 && reads.every((each) => each?.failed) ? reads[0]?.failed : undefined;
}
