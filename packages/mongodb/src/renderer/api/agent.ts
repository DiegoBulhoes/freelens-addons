import type { AgentHealth, AgentPlan, PodLike } from "./types";

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

export function readAgent(health: AgentHealth | undefined, pod: string): AgentView | undefined {
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

/** Kubernetes exec frames (v4.channel.k8s.io): the first byte names the stream. */
export function execOutput(frames: Uint8Array[]): { stdout: string; error?: string } {
  const decoder = new TextDecoder();
  let stdout = "";
  let error: string | undefined;

  for (const frame of frames) {
    const text = decoder.decode(frame.slice(1));

    if (frame[0] === 1) stdout += text;
    else if (frame[0] === 3 && text) {
      const status = JSON.parse(text) as { status?: string; message?: string };

      if (status.status !== "Success") error = status.message ?? "the command failed";
    }
  }

  return { stdout, error };
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
