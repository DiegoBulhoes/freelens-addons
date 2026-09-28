import type { ReportSubject } from "./types";

/**
 * Which pods a report's subject is actually running.
 *
 * A Trivy report names the controller — a ReplicaSet, a StatefulSet — because
 * that is what it scans the spec of. The pods are what is running, and they
 * are only knowable from the cluster, so this is the join between the report
 * and the thing an operator would go and look at.
 */

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
  /** What the host's own details drawer is opened with. */
  selfLink: string;
}

/**
 * Matched on ownerReferences rather than on the name, because a name prefix is
 * a coincidence a pod of another workload can share — `argocd-server` and
 * `argocd-server-metrics` being the shape of it.
 */
export function selectPodsOf<Pod extends PodLike>(pods: Pod[], subject: ReportSubject): Pod[] {
  return pods.filter((pod) => {
    if ((pod.getNs() ?? "") !== subject.namespace) return false;

    return pod
      .getOwnerRefs()
      .some((owner) => owner.kind === subject.kind && owner.name === subject.name);
  });
}

/**
 * Where a pod lives in the API. The cluster stopped sending `metadata.selfLink`
 * in Kubernetes 1.20 and the host derives it, so this is only reached when that
 * derivation has not happened — but the details drawer needs a path either way,
 * and this one is the same shape the API server used to send.
 */
export function podPath(namespace: string, name: string): string {
  return `/api/v1/namespaces/${namespace}/pods/${name}`;
}

export function describePod(pod: PodLike): RunningPod {
  return {
    name: pod.getName(),
    namespace: pod.getNs() ?? "",
    // A pod with no status yet is Unknown as far as anyone reading this cares.
    phase: pod.status?.phase ?? "Unknown",
    node: pod.getNodeName?.(),
    labels: pod.getLabels(),
    startedAt: pod.status?.startTime,
    selfLink: pod.selfLink ?? podPath(pod.getNs() ?? "", pod.getName()),
  };
}

/** Running first, then by name, so the healthy ones do not hide below the rest. */
export function sortPods(pods: RunningPod[]): RunningPod[] {
  const rank = (phase: string) => (phase === "Running" ? 0 : phase === "Succeeded" ? 2 : 1);

  return [...pods].sort((first, second) => {
    const byPhase = rank(first.phase) - rank(second.phase);

    return byPhase !== 0 ? byPhase : first.name.localeCompare(second.name);
  });
}

/**
 * Labels worth showing. The operator's own bookkeeping and the hashes
 * Kubernetes stamps on a pod say nothing about what it is.
 */
const NOISE = ["pod-template-hash", "controller-revision-hash", "pod-template-generation"];

export function interestingLabels(labels: string[]): string[] {
  return labels.filter((label) => !NOISE.some((noise) => label.startsWith(`${noise}=`)));
}
