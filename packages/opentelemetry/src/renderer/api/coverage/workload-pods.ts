import type { PodLike, PodTemplate, WorkloadKind, WorkloadLike } from "../shared/types";
import type { Language } from "./annotations";

const WORKLOAD_KINDS: readonly WorkloadKind[] = [
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "CronJob",
  "Job",
];

export function isWorkload(kind: string): kind is WorkloadKind {
  return (WORKLOAD_KINDS as readonly string[]).includes(kind);
}

/** Its pods run to completion: no restart applies, the next run is admitted afresh. */
export function isBatch(kind: string): boolean {
  return kind === "CronJob" || kind === "Job";
}

/** What the webhook admits: a CronJob's pods come from its jobTemplate. */
export function podTemplateOf(workload: WorkloadLike): PodTemplate {
  return (
    (workload.kind === "CronJob"
      ? workload.spec.jobTemplate?.spec?.template
      : workload.spec.template) ?? {}
  );
}

/** A row of its own; a Job that a CronJob or anything else owns is its owner's run. */
export function standsAlone(workload: WorkloadLike): boolean {
  if (!isWorkload(workload.kind)) return false;

  return workload.kind !== "Job" || (workload.metadata.ownerReferences ?? []).length === 0;
}

/** The CronJob's newest Job, whose pods say whether its runs get the agent. */
export function lastJobOf(
  cronJob: WorkloadLike,
  workloads: WorkloadLike[],
): WorkloadLike | undefined {
  const name = cronJob.getName();

  return workloads
    .filter(
      (each) =>
        each.kind === "Job" &&
        each.getNs() === cronJob.getNs() &&
        (each.metadata.ownerReferences ?? []).some(
          (owner) => owner.kind === "CronJob" && owner.name === name,
        ),
    )
    .sort(
      (a, b) =>
        (b.metadata.creationTimestamp ?? "").localeCompare(a.metadata.creationTimestamp ?? "") ||
        b.getName().localeCompare(a.getName()),
    )[0];
}

/** Deployment pods via ReplicaSet `<name>-<pod-template-hash>`; a CronJob's via its last Job in `workloads`. */
export function podsOf(
  workload: WorkloadLike,
  pods: PodLike[],
  workloads: WorkloadLike[] = [],
): PodLike[] {
  if (workload.kind === "CronJob") {
    const job = lastJobOf(workload, workloads);

    return job ? podsOf(job, pods) : [];
  }

  const name = workload.getName();

  return pods.filter((pod) => {
    if (pod.getNs() !== workload.getNs() || pod.metadata.deletionTimestamp) return false;

    const finished = pod.status?.phase === "Succeeded" || pod.status?.phase === "Failed";

    // A Job's finished pods are its run: they show whether it got the agent.
    if (finished && workload.kind !== "Job") return false;

    const owners = pod.metadata.ownerReferences ?? [];

    if (workload.kind === "Deployment") {
      const hash = pod.metadata.labels?.["pod-template-hash"];

      return owners.some(
        (owner) => owner.kind === "ReplicaSet" && owner.name === `${name}-${hash}`,
      );
    }

    return owners.some((owner) => owner.kind === workload.kind && owner.name === name);
  });
}

// helper.go isAutoInstrumentationInjected at v0.158.0, name for name.
export const AGENT_INIT_CONTAINERS: readonly string[] = [
  "opentelemetry-auto-instrumentation-dotnet",
  "opentelemetry-auto-instrumentation-java",
  "opentelemetry-auto-instrumentation-nodejs",
  "opentelemetry-auto-instrumentation-python",
  "otel-agent-attach-apache",
  "otel-agent-source-container-clone",
];
export const GO_SIDECAR = "opentelemetry-auto-instrumentation";
const MARKER_ENV = "OTEL_RESOURCE_ATTRIBUTES_NODE_NAME";
export const COLLECTOR_CONTAINER = "otc-container";
export const ALLOCATOR_CONTAINER = "ta-container";

// The container each language's injection adds; the SDK adds only variables.
const AGENT_OF: Record<Language, string | undefined> = {
  java: "opentelemetry-auto-instrumentation-java",
  nodejs: "opentelemetry-auto-instrumentation-nodejs",
  python: "opentelemetry-auto-instrumentation-python",
  dotnet: "opentelemetry-auto-instrumentation-dotnet",
  go: GO_SIDECAR,
  "apache-httpd": "otel-agent-attach-apache",
  nginx: "otel-agent-source-container-clone",
  sdk: undefined,
};

export interface PodInjection {
  pod: PodLike;
  /** With no languages given, any agent; else every one of theirs. */
  injected: boolean;
  /** Init containers, or the Go sidecar, that bring the agent. */
  agents: string[];
  /** The application containers the agent was set up in. */
  containers: string[];
}

export function injectionOf(pod: PodLike, languages: readonly Language[] = []): PodInjection {
  const regular = pod.spec?.containers ?? [];
  const agents = [
    ...(pod.spec?.initContainers ?? []).filter((each) => AGENT_INIT_CONTAINERS.includes(each.name)),
    ...regular.filter((each) => each.name === GO_SIDECAR),
  ].map((each) => each.name);
  const containers = regular
    .filter(
      (each) =>
        each.name !== COLLECTOR_CONTAINER &&
        each.name !== GO_SIDECAR &&
        (each.env ?? []).some((env) => env.name === MARKER_ENV),
    )
    .map((each) => each.name);

  const carries = (language: Language) => {
    const agent = AGENT_OF[language];

    return agent ? agents.includes(agent) : containers.length > 0;
  };

  return {
    pod,
    injected:
      languages.length > 0 ? languages.every(carries) : agents.length > 0 || containers.length > 0,
    agents,
    containers,
  };
}
