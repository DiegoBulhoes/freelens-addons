import type { CollectorRow } from "../collectors/collectors";
import type { CollectorMode, WorkloadKind } from "./types";

export type HostKind = "Pod" | WorkloadKind | "Instrumentation" | "OpenTelemetryCollector";

const LISTS: Record<HostKind, string> = {
  Pod: "/pods",
  Deployment: "/deployments",
  StatefulSet: "/statefulsets",
  DaemonSet: "/daemonsets",
  CronJob: "/cronjobs",
  Job: "/jobs",
  Instrumentation: "/crd/opentelemetry.io/instrumentations",
  OpenTelemetryCollector: "/crd/opentelemetry.io/opentelemetrycollectors",
};

export const LIST_NAMES: Record<HostKind, string> = {
  Pod: "Pods",
  Deployment: "Deployments",
  StatefulSet: "StatefulSets",
  DaemonSet: "DaemonSets",
  CronJob: "CronJobs",
  Job: "Jobs",
  Instrumentation: "Instrumentations",
  OpenTelemetryCollector: "OpenTelemetry collectors",
};

// A page of ours cannot open the host's drawer; host lists read ?search=.
export function hostListOf(kind: HostKind, name: string): string {
  return `${LISTS[kind]}?search=${encodeURIComponent(name)}`;
}

const WORKLOADS: Partial<Record<CollectorMode, WorkloadKind>> = {
  deployment: "Deployment",
  daemonset: "DaemonSet",
  statefulset: "StatefulSet",
};

/** The workload the operator runs a collector as, named `<name>-collector`; a sidecar has none. */
export function collectorWorkloadOf(
  row: CollectorRow,
): { kind: WorkloadKind; name: string } | undefined {
  const kind = WORKLOADS[row.mode];

  return kind && { kind, name: `${row.name}-collector` };
}

const MONITOR_CRDS = ["servicemonitors.monitoring.coreos.com", "podmonitors.monitoring.coreos.com"];

// The host routes a page as /extension/<package name, @ dropped and / as -->/<page id>.
const PROMETHEUS_MONITORS = "/extension/freelens-addons--prometheus/monitors";

/** The Prometheus extension's Monitors searched by the collector, when it makes or reads monitors. */
export function monitorsListOf(row: CollectorRow, crdNames: Iterable<string>): string | undefined {
  if (!row.metrics.serviceMonitor && !(row.targetAllocator && row.metrics.prometheusCR)) {
    return undefined;
  }
  if (![...crdNames].some((name) => MONITOR_CRDS.includes(name))) return undefined;

  return `${PROMETHEUS_MONITORS}?name=${encodeURIComponent(row.name)}`;
}
