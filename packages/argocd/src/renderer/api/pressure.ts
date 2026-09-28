import type { KubeEvent, Node } from "@freelensapp/kube-object";

export interface ClusterPressure {
  node: string;
  condition: string;
  message?: string;
  selfLink: string;
}

export const RECENT_EVENT_MS = 60 * 60_000;

function pressureFromNodeConditions(node: Node): ClusterPressure[] {
  const nodeName = node.getName();
  const { selfLink } = node;
  const pressures: ClusterPressure[] = [];

  // getWarningConditions() skips Ready, whose polarity is reversed.
  for (const condition of node.getWarningConditions()) {
    pressures.push({
      node: nodeName,
      condition: condition.type,
      message: condition.message,
      selfLink,
    });
  }

  const ready = node.getConditions().find((condition) => condition.type === "Ready");

  if (ready && ready.status !== "True") {
    pressures.push({ node: nodeName, condition: "NotReady", message: ready.message, selfLink });
  }

  if (node.isUnschedulable()) {
    pressures.push({
      node: nodeName,
      condition: "Unschedulable",
      message: "Cordoned: nothing new will be scheduled here.",
      selfLink,
    });
  }

  return pressures;
}

function isRecentNodeWarning(event: KubeEvent, now: number): boolean {
  if (!event.isWarning()) return false;
  if (event.involvedObject?.kind !== "Node") return false;

  const lastSeenAt = Date.parse(event.lastTimestamp ?? event.eventTime ?? "");

  return !Number.isNaN(lastSeenAt) && now - lastSeenAt <= RECENT_EVENT_MS;
}

function selfLinkOfNode(nodes: Node[], nodeName: string): string {
  return nodes.find((node) => node.getName() === nodeName)?.selfLink ?? "";
}

/** Conditions appear only once the kubelet is evicting; its warnings arrive earlier. */
function pressureFromNodeEvents(
  nodes: Node[],
  events: KubeEvent[],
  now: number,
): ClusterPressure[] {
  return events
    .filter((event) => isRecentNodeWarning(event, now))
    .map((event) => ({
      node: event.involvedObject.name,
      condition: event.reason ?? "Warning",
      message: event.message,
      selfLink: selfLinkOfNode(nodes, event.involvedObject.name),
    }));
}

/** The kubelet repeats a warning every few minutes. */
function keepFirstOfEachProblem(pressures: ClusterPressure[]): ClusterPressure[] {
  const seen = new Set<string>();

  return pressures.filter((pressure) => {
    const problem = `${pressure.node}/${pressure.condition}`;

    if (seen.has(problem)) return false;

    seen.add(problem);

    return true;
  });
}

export function getPressure(
  nodes: Node[],
  events: KubeEvent[],
  now = Date.now(),
): ClusterPressure[] {
  return keepFirstOfEachProblem([
    ...nodes.flatMap(pressureFromNodeConditions),
    ...pressureFromNodeEvents(nodes, events, now),
  ]);
}
