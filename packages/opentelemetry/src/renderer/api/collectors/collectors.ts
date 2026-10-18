import { keyOf } from "../coverage/resolve";
import { ALLOCATOR_CONTAINER, COLLECTOR_CONTAINER } from "../coverage/workload-pods";
import { byNamespace } from "../shared/namespace-scope";
import type { CollectorLike, CollectorMode, PodLike } from "../shared/types";
import { plural, RANK, type Verdict } from "../shared/verdict";
import { type Crash, causeKey, containerStatusOf, crashOf, needsLog } from "./causes";

export const SIDECAR_LABEL = "sidecar.opentelemetry.io/injected";

/** internal/naming Truncate("%s.%s", 63, namespace, name) at v0.158.0: the namespace gives way first. */
export function instanceLabel(namespace: string, name: string): string {
  let excess = namespace.length + 1 + name.length - 63;
  const [first, second] = [namespace, name].map((value) => {
    if (excess <= 0) return value;

    const kept = Math.max(0, value.length - excess);

    excess -= value.length - kept;

    return value.slice(0, kept);
  });

  return `${first}.${second}`.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
}

/** `key=value` terms joined by commas, as the operator writes status.scale.selector; else undefined. */
export function parseSelector(selector: string | undefined): Record<string, string> | undefined {
  if (!selector) return undefined;

  const terms = selector.split(",");
  const pairs = terms
    .map((term) => /^([\w./-]+)==?([\w.-]*)$/.exec(term.trim()))
    .filter((pair) => pair !== null);

  if (pairs.length !== terms.length) return undefined;

  return Object.fromEntries(pairs.map(([, key, value]) => [key, value]));
}

const isLive = (pod: PodLike) =>
  !pod.metadata.deletionTimestamp &&
  pod.status?.phase !== "Succeeded" &&
  pod.status?.phase !== "Failed";

const operatorLabels = (component: string, instance: string) => ({
  "app.kubernetes.io/managed-by": "opentelemetry-operator",
  "app.kubernetes.io/component": component,
  "app.kubernetes.io/instance": instance,
});

const carriesLabels = (pod: PodLike, wanted: Record<string, string>) =>
  Object.entries(wanted).every(([key, value]) => pod.metadata.labels?.[key] === value);

/** By the collector's own selector, which leaves out its target allocator's pods. */
export function podsOfCollector(collector: CollectorLike, pods: PodLike[]): PodLike[] {
  const namespace = collector.getNs();
  const instance = instanceLabel(String(namespace), collector.getName());
  const sidecar = collector.spec.mode === "sidecar";
  const wanted = sidecar
    ? { [SIDECAR_LABEL]: instance }
    : (parseSelector(collector.status?.scale?.selector) ??
      operatorLabels("opentelemetry-collector", instance));

  return pods.filter(
    (pod) => (sidecar || pod.getNs() === namespace) && isLive(pod) && carriesLabels(pod, wanted),
  );
}

/** Its target allocator's pods, by the labels the operator gives them; none while it is off. */
export function allocatorPodsOf(collector: CollectorLike, pods: PodLike[]): PodLike[] {
  if (!collector.spec.targetAllocator?.enabled) return [];

  const namespace = collector.getNs();
  const wanted = operatorLabels(
    "opentelemetry-targetallocator",
    instanceLabel(String(namespace), collector.getName()),
  );

  return pods.filter(
    (pod) => pod.getNs() === namespace && isLive(pod) && carriesLabels(pod, wanted),
  );
}

export function isReady(pod: PodLike): boolean {
  return !!pod.status?.conditions?.some(
    (condition) => condition.type === "Ready" && condition.status === "True",
  );
}

export interface CollectorRow {
  key: string;
  collector: CollectorLike;
  name: string;
  namespace: string;
  mode: CollectorMode;
  pods: PodLike[];
  /** Ready pods and how many there should be; sidecars have no count of their own. */
  replicas?: { ready: number; desired: number };
  version?: string;
  image?: string;
  targetAllocator: boolean;
  metrics: { serviceMonitor: boolean; prometheusCR: boolean };
  managementState: "managed" | "unmanaged";
  crashes: Crash[];
  /** While a target allocator is enabled: the prometheus receiver's targets come from its pods. */
  allocator?: { pods: PodLike[]; ready: number; desired: number; crashes: Crash[] };
  verdict: Verdict;
}

export type CollectorBase = Omit<CollectorRow, "verdict">;

const describeExit = (crash: Crash) =>
  `exit code ${crash.exitCode ?? "unknown"}${crash.reason ? ` (${crash.reason})` : ""}, ${plural(crash.restarts, "restart")}`;

function crashReason(crash: Crash, causes: ReadonlyMap<string, string>): string {
  const cause = causes.get(causeKey(crash.pod));

  if (cause) return `${cause}; ${describeExit(crash)}.`;

  return `${crash.pod.getName()}: ${describeExit(crash)}; ${needsLog(crash) ? "its previous log says why" : "it ran out of its memory limit"}.`;
}

const firstWaitingReason = (pods: PodLike[], container: string) =>
  pods.map((pod) => containerStatusOf(pod, container)?.state?.waiting?.reason).find(Boolean);

function allocatorVerdict(allocator: NonNullable<CollectorRow["allocator"]>): Verdict | undefined {
  const [crash] = allocator.crashes;
  const unscraped = "its prometheus receiver gets no targets meanwhile.";

  if (crash) {
    return {
      tone: "warning",
      label: "Target allocator crash looping",
      reason: `${crash.pod.getName()}: ${describeExit(crash)}; ${unscraped}`,
    };
  }
  if (allocator.ready < allocator.desired) {
    const waiting = firstWaitingReason(allocator.pods, ALLOCATOR_CONTAINER);

    return {
      tone: "warning",
      label: "Target allocator not ready",
      reason: `${allocator.ready} of ${plural(allocator.desired, "target allocator pod")} ready${waiting ? `, waiting: ${waiting}` : ""}; ${unscraped}`,
    };
  }

  return undefined;
}

function collectorVerdict(row: CollectorBase, causes: ReadonlyMap<string, string>): Verdict {
  const [crash] = row.crashes;

  if (crash) {
    return {
      tone: "critical",
      label: "Crash looping",
      reason: crashReason(crash, causes),
    };
  }
  if (row.replicas && row.replicas.ready < row.replicas.desired) {
    const waiting = firstWaitingReason(row.pods, COLLECTOR_CONTAINER);

    return {
      tone: "warning",
      label: "Not ready",
      reason: `${row.replicas.ready} of ${plural(row.replicas.desired, "pod")} ready.${waiting ? ` Waiting: ${waiting}.` : ""}`,
    };
  }

  const allocator = row.allocator && allocatorVerdict(row.allocator);

  if (allocator) return allocator;
  if (row.managementState === "unmanaged") {
    return {
      tone: "info",
      label: "Unmanaged",
      reason: "managementState is unmanaged: the operator leaves it as it is.",
    };
  }
  if (!row.replicas) {
    return row.pods.length > 0
      ? {
          tone: "ok",
          label: `In ${plural(row.pods.length, "pod")}`,
          reason: "Runs as a sidecar.",
        }
      : {
          tone: "info",
          label: "In no pod",
          reason: "No pod in the namespaces in scope carries it as a sidecar.",
        };
  }

  return {
    tone: "ok",
    label: "Ready",
    reason: `${row.replicas.ready} of ${plural(row.replicas.desired, "pod")} ready.`,
  };
}

/** Readiness from the pods: the Ready condition stays True while the collector crash loops. */
export function collectorBases(
  collectors: CollectorLike[],
  pods: PodLike[],
  now: number,
): CollectorBase[] {
  const index = byNamespace(pods);

  return collectors.map((collector) => {
    const mode = collector.spec.mode ?? "deployment";
    const namespace = String(collector.getNs());
    const local = index.get(namespace) ?? [];
    // A sidecar's label names its collector's namespace, so its pods may be anywhere.
    const own = podsOfCollector(collector, mode === "sidecar" ? pods : local);
    const allocatorPods = allocatorPodsOf(collector, local);
    const desired =
      collector.status?.scale?.replicas ??
      (mode === "daemonset" ? own.length : (collector.spec.replicas ?? 1));

    return {
      key: keyOf(collector),
      collector,
      name: collector.getName(),
      namespace,
      mode,
      pods: own,
      replicas: mode === "sidecar" ? undefined : { ready: own.filter(isReady).length, desired },
      version: collector.status?.version,
      image: collector.status?.image,
      targetAllocator: !!collector.spec.targetAllocator?.enabled,
      metrics: {
        serviceMonitor: !!collector.spec.observability?.metrics?.enableMetrics,
        prometheusCR: !!collector.spec.targetAllocator?.prometheusCR?.enabled,
      },
      managementState: collector.spec.managementState ?? "managed",
      crashes: own.flatMap((pod) => crashOf(pod, now) ?? []),
      allocator: collector.spec.targetAllocator?.enabled
        ? {
            pods: allocatorPods,
            ready: allocatorPods.filter(isReady).length,
            desired: collector.spec.targetAllocator.replicas ?? 1,
            crashes: allocatorPods.flatMap((pod) => crashOf(pod, now, ALLOCATOR_CONTAINER) ?? []),
          }
        : undefined,
    };
  });
}

/** The crashing collector pods whose previous log is worth a read. */
export function crashingPods(bases: CollectorBase[]): PodLike[] {
  return bases.flatMap((base) => base.crashes.filter(needsLog).map((crash) => crash.pod));
}

export function judgeCollectors(
  bases: CollectorBase[],
  causes: ReadonlyMap<string, string>,
): CollectorRow[] {
  return bases
    .map((base) => ({ ...base, verdict: collectorVerdict(base, causes) }))
    .sort((a, b) => RANK[a.verdict.tone] - RANK[b.verdict.tone] || a.key.localeCompare(b.key));
}

export function collectorRows(
  collectors: CollectorLike[],
  pods: PodLike[],
  causes: ReadonlyMap<string, string>,
  now: number,
): CollectorRow[] {
  return judgeCollectors(collectorBases(collectors, pods, now), causes);
}

export function collectorSearchTexts(row: CollectorRow): string[] {
  return [row.name, row.namespace, row.key, row.mode, row.verdict.label];
}

export function describeReady(row: CollectorRow): string {
  return row.replicas
    ? `${row.replicas.ready}/${row.replicas.desired}`
    : plural(row.pods.length, "pod");
}
