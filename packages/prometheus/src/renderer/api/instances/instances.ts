import { describeSelector, namespaceOf, objectKey } from "../shared/selectors";
import type { AlertmanagerLike, Condition, PrometheusLike, ShardStatus } from "../shared/types";
import type { Verdict } from "../shared/verdict";

export type InstanceKind = "Prometheus" | "PrometheusAgent" | "Alertmanager";

export function condition(
  object: { status?: { conditions?: Condition[] } },
  type: "Available" | "Reconciled",
): Condition | undefined {
  return object.status?.conditions?.find((each) => each.type === type);
}

export interface InstanceRow {
  key: string;
  kind: InstanceKind;
  name: string;
  namespace: string;
  object: PrometheusLike | AlertmanagerLike;
  available?: Condition;
  reconciled?: Condition;
  paused: boolean;
  /** replicas × shards, as the operator counts them; in DaemonSet mode, one per node it runs on. */
  desired: number;
  ready: number;
  shards: number;
  shardStatuses: ShardStatus[];
  alertmanagers: string[];
  /** The Alertmanagers a Prometheus with alerting set discovered; undefined until read. */
  alerting?: AlertingRead;
  /** What it selects, one line per kind; empty for an Alertmanager. */
  selects: string[];
  verdict: Verdict;
}

export interface AlertingRead {
  source: string;
  /** The Alertmanager URLs it sends to; none means its alerts reach nobody. */
  active?: string[];
  error?: string;
}

// Each shard sends its own alerts, so the shard that found the fewest stands for the instance.
export function mergeAlerting(
  source: string,
  shards: { active?: string[]; error?: string }[],
): AlertingRead {
  const failed = shards.find((shard) => shard.error);

  if (failed || shards.length === 0) {
    return { source, error: failed?.error ?? "No Prometheus pod is running and ready" };
  }

  const [fewest] = shards.map((shard) => shard.active ?? []).sort((a, b) => a.length - b.length);

  return { source, active: [...new Set(fewest)] };
}

/** Whether to read where its alerts go: running, with alerting set. */
export function asksAlerting(prometheus: PrometheusLike): boolean {
  return !prometheus.spec.paused && alertmanagersOf(prometheus).length > 0;
}

/** What the drawer says of where its alerts go; undefined when alerting is not set. */
export function describeAlerting(row: InstanceRow): string | undefined {
  if (row.kind !== "Prometheus" || row.alertmanagers.length === 0) return undefined;

  const { alerting } = row;

  if (!alerting) return row.paused ? "Not read: it is paused" : "Not read yet";
  if (alerting.error) return `Not read: ${alerting.error}`;

  const active = alerting.active ?? [];

  return active.length > 0 ? active.join(", ") : "No Alertmanager discovered";
}

export function alertmanagersOf(prometheus: PrometheusLike): string[] {
  return (prometheus.spec.alerting?.alertmanagers ?? []).map(
    (each) =>
      `${each.namespace ?? namespaceOf(prometheus)}/${each.name}${each.port === undefined ? "" : `:${each.port}`}`,
  );
}

function selectsOf(object: PrometheusLike, kind: InstanceKind): string[] {
  const { spec } = object;
  const lines = [
    ["ServiceMonitors", spec.serviceMonitorSelector],
    ["PodMonitors", spec.podMonitorSelector],
    ["ScrapeConfigs", spec.scrapeConfigSelector],
    ...(kind === "Prometheus" ? [["Rules", spec.ruleSelector] as const] : []),
  ] as const;

  return lines.map(([label, selector]) => `${label}: ${describeSelector(selector)}`);
}

function verdictOf(row: Omit<InstanceRow, "verdict">): Verdict {
  const { available, reconciled } = row;

  if (row.paused) {
    return { tone: "info", label: "Paused", reason: "The operator leaves it as it is" };
  }
  if (reconciled?.status === "False") {
    return {
      tone: "critical",
      label: "Not reconciled",
      reason: reconciled.message || reconciled.reason || "The operator could not apply its spec",
    };
  }
  if (available?.status === "False") {
    return {
      tone: "critical",
      label: "Not available",
      reason: available.message || available.reason || `${row.ready} of ${row.desired} ready`,
    };
  }
  if (row.alerting?.active?.length === 0) {
    return {
      tone: "warning",
      label: "No Alertmanager",
      reason: `Sends to no Alertmanager: none discovered behind ${row.alertmanagers.join(", ")}`,
    };
  }
  if (available?.status === "Degraded") {
    return {
      tone: "warning",
      label: "Degraded",
      reason: available.message || `${row.ready} of ${row.desired} ready`,
    };
  }
  if (available?.status === "True") {
    return { tone: "ok", label: "Available", reason: `${row.ready} of ${row.desired} ready` };
  }

  return { tone: "info", label: "Unknown", reason: "The operator has not reported its state" };
}

export const isDaemonSet = (object: PrometheusLike, kind: InstanceKind) =>
  kind === "PrometheusAgent" && object.spec.mode === "DaemonSet";

function rowOf(
  kind: InstanceKind,
  object: PrometheusLike | AlertmanagerLike,
  alerting: Map<string, AlertingRead>,
): InstanceRow {
  const namespace = namespaceOf(object);
  const daemonSet = isDaemonSet(object as PrometheusLike, kind);
  const ready = object.status?.availableReplicas ?? 0;
  const shards =
    kind === "Alertmanager" || daemonSet ? 1 : ((object as PrometheusLike).spec.shards ?? 1);
  // A DaemonSet ignores replicas and shards: its status counts the pods scheduled.
  const replicas = daemonSet ? (object.status?.replicas ?? ready) : (object.spec.replicas ?? 1);
  const key = objectKey(kind, namespace, object.getName());
  const alertmanagers = kind === "Prometheus" ? alertmanagersOf(object as PrometheusLike) : [];
  const row = {
    key,
    kind,
    name: object.getName(),
    namespace,
    object,
    available: condition(object, "Available"),
    reconciled: condition(object, "Reconciled"),
    paused: Boolean(object.spec.paused ?? object.status?.paused),
    desired: replicas * shards,
    ready,
    shards,
    shardStatuses: object.status?.shardStatuses ?? [],
    alertmanagers,
    alerting: alertmanagers.length > 0 ? alerting.get(key) : undefined,
    selects: kind === "Alertmanager" ? [] : selectsOf(object as PrometheusLike, kind),
  };

  return { ...row, verdict: verdictOf(row) };
}

/** `alerting`: what each Prometheus answered on its Alertmanagers, keyed as its source. */
export function instanceRows(
  prometheuses: PrometheusLike[],
  agents: PrometheusLike[],
  alertmanagers: AlertmanagerLike[],
  alerting: AlertingRead[] = [],
): InstanceRow[] {
  const bySource = new Map(alerting.map((read) => [read.source, read]));

  return [
    ...prometheuses.map((each) => rowOf("Prometheus", each, bySource)),
    ...agents.map((each) => rowOf("PrometheusAgent", each, bySource)),
    ...alertmanagers.map((each) => rowOf("Alertmanager", each, bySource)),
  ];
}

export type InstanceFilter = "attention";

export const INSTANCE_FILTER_TITLES: Record<InstanceFilter, string> = {
  attention: "Shows instances that are not available, degraded, not reconciled or alerting nobody",
};

/** The rows the Overview's card counts: not available, degraded, not reconciled or alerting nobody. */
export function matchesInstanceFilter(
  row: InstanceRow,
  filter: InstanceFilter | undefined,
): boolean {
  return !filter || row.verdict.tone === "critical" || row.verdict.tone === "warning";
}

export function isInstanceFilter(value: string | undefined): value is InstanceFilter {
  return value === "attention";
}
