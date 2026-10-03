import type { ReportSubject } from "./types";

export interface PodLike {
  getName(): string;
  getNs(): string | undefined;
  getOwnerRefs(): { kind?: string; name?: string }[];
  getLabels(): string[];
  getNodeName?(): string | undefined;
  selfLink?: string;
  status?: { phase?: string; podIP?: string; startTime?: string };
}

export interface RunningPod {
  name: string;
  namespace: string;
  phase: string;
  node?: string;
  labels: string[];
  startedAt?: string;
  selfLink: string;
}

// Matched on ownerReferences: a name prefix is shared by `argocd-server` and `argocd-server-metrics`.
export function selectPodsOf<Pod extends PodLike>(pods: Pod[], subject: ReportSubject): Pod[] {
  return pods.filter((pod) => {
    if ((pod.getNs() ?? "") !== subject.namespace) return false;

    return pod
      .getOwnerRefs()
      .some((owner) => owner.kind === subject.kind && owner.name === subject.name);
  });
}

// Fallback for when the host has not derived selfLink, dropped in Kubernetes 1.20.
export function podPath(namespace: string, name: string): string {
  return `/api/v1/namespaces/${namespace}/pods/${name}`;
}

export function describePod(pod: PodLike): RunningPod {
  return {
    name: pod.getName(),
    namespace: pod.getNs() ?? "",
    phase: pod.status?.phase ?? "Unknown",
    node: pod.getNodeName?.(),
    labels: pod.getLabels(),
    startedAt: pod.status?.startTime,
    selfLink: pod.selfLink ?? podPath(pod.getNs() ?? "", pod.getName()),
  };
}

export function sortPods(pods: RunningPod[]): RunningPod[] {
  const rank = (phase: string) => (phase === "Running" ? 0 : phase === "Succeeded" ? 2 : 1);

  return [...pods].sort((first, second) => {
    const byPhase = rank(first.phase) - rank(second.phase);

    return byPhase !== 0 ? byPhase : first.name.localeCompare(second.name);
  });
}

const NOISE = ["pod-template-hash", "controller-revision-hash", "pod-template-generation"];

export function interestingLabels(labels: string[]): string[] {
  return labels.filter((label) => !NOISE.some((noise) => label.startsWith(`${noise}=`)));
}
