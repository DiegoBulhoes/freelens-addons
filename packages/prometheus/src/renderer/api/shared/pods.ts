import { namespaceOf } from "./selectors";
import type { PodLike } from "./types";

// Native sidecars run beside the containers: cAdvisor counts their usage, Prometheus finds their ports.
export const runningContainers = (pod: PodLike) => [
  ...(pod.spec?.containers ?? []),
  ...(pod.spec?.initContainers ?? []).filter((each) => each.restartPolicy === "Always"),
];

export const hasReadyCondition = (pod: PodLike) =>
  pod.status?.conditions?.some((each) => each.type === "Ready" && each.status === "True") ?? false;

export const keyOf = (object: { getNs(): string | undefined; getName(): string }) =>
  `${namespaceOf(object)}/${object.getName()}`;
