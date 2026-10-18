import type { MetricData, QueryRange } from "../shared/types";
import { hasSeries, seriesOf } from "./series";
import type { ChoiceNames } from "./usage-filters";

export const WINDOWS = [
  { id: "5m", seconds: 300, label: "5 minutes" },
  { id: "15m", seconds: 900, label: "15 minutes" },
  { id: "30m", seconds: 1_800, label: "30 minutes" },
  { id: "1h", seconds: 3_600, label: "1 hour" },
  { id: "6h", seconds: 6 * 3_600, label: "6 hours" },
  { id: "24h", seconds: 24 * 3_600, label: "24 hours" },
  { id: "7d", seconds: 7 * 24 * 3_600, label: "7 days" },
] as const;

export type WindowId = (typeof WINDOWS)[number]["id"];

const windowOf = (id: WindowId) => WINDOWS.find((each) => each.id === id);

export const DEFAULT_WINDOW: WindowId = "1h";

const SHORT = 1_800;

/** The host's own step table, finer for the short windows, passed so the rate window can follow it. */
export function stepFor(rangeSeconds: number): number {
  if (rangeSeconds <= SHORT) return 15;
  if (rangeSeconds <= 4 * 3_600) return 60;
  if (rangeSeconds <= 24 * 3_600) return 600;
  if (rangeSeconds <= 4 * 24 * 3_600) return 3_600;
  if (rangeSeconds <= 14 * 24 * 3_600) return 10_800;
  if (rangeSeconds <= 30 * 24 * 3_600) return 21_600;

  // Prometheus refuses more than 11,000 points per series.
  return Math.max(43_200, Math.ceil(rangeSeconds / 11_000));
}

export function promDuration(seconds: number): string {
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;

  return `${seconds}s`;
}

// Two steps and at least 2m: four samples at a 30s scrape, so rate() never comes back empty.
export function rateWindow(step: number): string {
  return promDuration(Math.max(2 * step, 120));
}

// The current values are the last point of 5 minutes at a 60s step.
export const CURRENT_WINDOW = rateWindow(60);

export const chartWindow = (period: Period) => rateWindow(stepFor(periodSeconds(period)));

export const NODE_CHOICES: ChoiceNames = { all: "All nodes", one: "Node", many: "Nodes" };

/** Ends on the step's grid, a minute at most, so every refresh asks for the same points. */
export function rangeFor(rangeSeconds: number, nowMs: number): QueryRange {
  const step = stepFor(rangeSeconds);
  const grid = Math.min(step, 60);
  const end = Math.floor(nowMs / 1000 / grid) * grid;

  return { start: end - rangeSeconds, end, step };
}

// No instant query reaches an extension: "now" is the last point of a short range.
export function currentRange(nowMs: number): QueryRange {
  const end = Math.floor(nowMs / 60_000) * 60;

  return { start: end - 300, end, step: 60 };
}

/** A fixed range is in epoch seconds. */
export type Period = { id: WindowId } | { start: number; end: number };

export const isFixed = (period: Period): period is { start: number; end: number } =>
  "start" in period;

export function periodSeconds(period: Period): number {
  return isFixed(period) ? period.end - period.start : (windowOf(period.id)?.seconds ?? 3_600);
}

export const periodKey = (period: Period) =>
  isFixed(period) ? `${period.start}-${period.end}` : period.id;

/** A current read ends now whatever the rolling window, so only a fixed range's end keys it. */
export function metricsKey(queries: object, period: Period, kind: "current" | "chart"): string {
  const when = kind === "chart" ? periodKey(period) : isFixed(period) ? `${period.end}` : "now";

  return JSON.stringify([queries, when, kind]);
}

/** "Asking now." only until a read has an answer; a refresh keeps the last one on screen. */
export function isFirstAsk(probed: boolean, reads: { range?: QueryRange; loading: boolean }[]) {
  return !probed || reads.some((read) => read.loading && read.range === undefined);
}

export function periodRange(period: Period, nowMs: number): QueryRange {
  return isFixed(period)
    ? { start: period.start, end: period.end, step: stepFor(period.end - period.start) }
    : rangeFor(periodSeconds(period), nowMs);
}

// The table shows a fixed range's last figures, so its end stands for now.
export function periodCurrent(period: Period, nowMs: number): QueryRange {
  return currentRange(isFixed(period) ? period.end * 1000 : nowMs);
}

export function refreshFor(period: Period): number | undefined {
  if (isFixed(period)) return undefined;

  return periodSeconds(period) <= SHORT ? 15_000 : 60_000;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** In local time, as the datetime-local input reads and writes it. */
export function toLocalInput(seconds: number): string {
  const date = new Date(seconds * 1000);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);

  if (!parts) return undefined;

  const [year, month, day, hour, minute] = parts.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(0);

  // The Date constructor reads a year below 100 as 19xx.
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, 0, 0);

  return date.getMonth() === month - 1 ? date.getTime() / 1000 : undefined;
}

export function parseRange(
  from: string,
  to: string,
  nowMs: number,
): { start: number; end: number } | { error: string } {
  const start = fromLocalInput(from);
  const end = fromLocalInput(to);

  if (start === undefined || end === undefined) return { error: "Pick a start and an end." };
  if (start < 0) return { error: "The start must be after 1970." };
  if (start >= end) return { error: "The start must be before the end." };
  if (end > nowMs / 1000) return { error: "The end cannot be in the future." };

  return { start, end };
}

export interface TypedRange {
  from: string;
  to: string;
  error?: string;
}

/** What the range dialog opens with; a refused range comes back as typed, with its error. */
export function editorRange(period: Period, nowMs: number, typed?: TypedRange): TypedRange {
  if (typed) return typed;

  const { end: now } = currentRange(nowMs);
  const { start, end } = isFixed(period)
    ? period
    : { start: now - periodSeconds(period), end: now };

  return { from: toLocalInput(start), to: toLocalInput(end) };
}

export function describePeriod(period: Period): string {
  if (!isFixed(period)) return `the last ${windowOf(period.id)?.label}`;

  return `${toLocalInput(period.start).replace("T", " ")} to ${toLocalInput(period.end).replace("T", " ")}`;
}

export function describeRefresh(period: Period): string {
  const every = refreshFor(period);

  if (every === undefined) return "A fixed range is not asked again until Refresh is pressed.";

  return `Asked again every ${every === 60_000 ? "minute" : `${every / 1000} seconds`} while shown.`;
}

export type NodeLabel = "node" | "kubernetes_node" | "instance";

/** In the order they are tried. */
export const NODE_LABELS: readonly NodeLabel[] = ["node", "kubernetes_node", "instance"];

export const probeQuery = (label: NodeLabel) => `count by(${label})(node_uname_info)`;

export const PROBE_RETRIES = 3;
export const PROBE_RETRY_MS = 5_000;

/** A probe that named no node is asked again soon, a few times, before waiting for the next tick. */
export function probeRetryIn(found: boolean, attempt: number): number | undefined {
  return found || attempt >= PROBE_RETRIES ? undefined : PROBE_RETRY_MS;
}

// A Mimir tenant shared by clusters holds same-named nodes and pods from each.
export const CLUSTER_PROBE = "count by(cluster)(node_uname_info)";

export function clustersFrom(data: MetricData | undefined): string[] {
  return [
    ...new Set(
      seriesOf(data).flatMap((series) => (series.metric.cluster ? [series.metric.cluster] : [])),
    ),
  ].sort();
}

/** The first label that names something; a series whose label is empty does not count. */
export function nodeLabelFrom(
  probes: Partial<Record<NodeLabel, MetricData | undefined>>,
): NodeLabel | undefined {
  return NODE_LABELS.find((label) => hasSeries(probes[label], (metric) => Boolean(metric[label])));
}

const FS = 'fstype!~"tmpfs|overlay|squashfs"';
const NET = 'device!~"lo|veth.*|cni.*|flannel.*|cali.*"';
const CONTAINER = 'container!="",container!="POD",image!=""';

export type NodeQuery =
  | "nodeCpuUsed"
  | "nodeCpuCores"
  | "nodeMemoryUsed"
  | "nodeMemoryTotal"
  | "nodeFsUsed"
  | "nodeFsSize"
  | "nodeDiskRead"
  | "nodeDiskWritten"
  | "nodeNetRx"
  | "nodeNetTx";

export function nodeQueries(label: NodeLabel, window: string): Record<NodeQuery, string> {
  const by = `sum by(${label})`;
  const byDevice = `max by(${label},device)`;

  return {
    nodeCpuUsed: `${by}(rate(node_cpu_seconds_total{mode!~"idle|iowait|steal"}[${window}]))`,
    nodeCpuCores: `count by(${label})(node_cpu_seconds_total{mode="idle"})`,
    nodeMemoryUsed: `${by}(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)`,
    nodeMemoryTotal: `${by}(node_memory_MemTotal_bytes)`,
    nodeFsUsed: `${byDevice}(node_filesystem_size_bytes{${FS}} - node_filesystem_avail_bytes{${FS}})`,
    nodeFsSize: `${byDevice}(node_filesystem_size_bytes{${FS}})`,
    nodeDiskRead: `${by}(rate(node_disk_read_bytes_total[${window}]))`,
    nodeDiskWritten: `${by}(rate(node_disk_written_bytes_total[${window}]))`,
    nodeNetRx: `${by}(rate(node_network_receive_bytes_total{${NET}}[${window}]))`,
    nodeNetTx: `${by}(rate(node_network_transmit_bytes_total{${NET}}[${window}]))`,
  };
}

export type PodQuery =
  | "podCpu"
  | "podMemory"
  | "containerCpu"
  | "containerMemory"
  | "podNetRx"
  | "podNetTx"
  | "podDiskIo"
  | "pvcUsed"
  | "pvcCapacity";

const escapeRegex = (values: string[]) =>
  values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&")).join("|");

/** Narrows every pod query to the namespaces in scope; undefined when the scope is the cluster. */
export function namespaceMatcher(
  scope: readonly string[],
  all: readonly string[],
): string | undefined {
  const wanted = [...new Set(scope)].sort();

  if (wanted.length === 0 || all.every((namespace) => wanted.includes(namespace))) return undefined;

  return `namespace=~"${escapeRegex(wanted)}"`;
}

export function podQueries(window: string, namespaces?: string): Record<PodQuery, string> {
  const by = "sum by(namespace,pod)";
  const pvc = "sum by(namespace,persistentvolumeclaim)";
  const scoped = (matchers: string) => [matchers, namespaces].filter(Boolean).join(",");
  const container = scoped(CONTAINER);
  const sandbox = scoped('pod!="",interface!="lo"');
  const fs = scoped('container!="",image!=""');
  const volume = (metric: string) => (namespaces ? `${metric}{${namespaces}}` : metric);

  return {
    podCpu: `${by}(rate(container_cpu_usage_seconds_total{${container}}[${window}]))`,
    podMemory: `${by}(container_memory_working_set_bytes{${container}})`,
    // Limits are enforced per container, so the attention check compares each with its own.
    containerCpu: `sum by(namespace,pod,container)(rate(container_cpu_usage_seconds_total{${container}}[${window}]))`,
    containerMemory: `sum by(namespace,pod,container)(container_memory_working_set_bytes{${container}})`,
    // Network is counted on the pod's sandbox, which has no container label.
    podNetRx: `${by}(rate(container_network_receive_bytes_total{${sandbox}}[${window}]))`,
    podNetTx: `${by}(rate(container_network_transmit_bytes_total{${sandbox}}[${window}]))`,
    podDiskIo: `${by}(rate(container_fs_reads_bytes_total{${fs}}[${window}]) + rate(container_fs_writes_bytes_total{${fs}}[${window}]))`,
    pvcUsed: `${pvc}(${volume("kubelet_volume_stats_used_bytes")})`,
    pvcCapacity: `${pvc}(${volume("kubelet_volume_stats_capacity_bytes")})`,
  };
}

/** Narrows a pod query to the chosen pods, for the chart of a selection. */
export function forPods(query: string, pods: { namespace: string; name: string }[]): string {
  // Sorted, so the same pods in another order ask the same query.
  const namespaces = [...new Set(pods.map((pod) => pod.namespace))].sort();
  const names = [...new Set(pods.map((pod) => pod.name))].sort();

  return query.replace(
    /\{([^}]*)\}/g,
    (_, inner: string) =>
      `{${inner ? `${inner},` : ""}namespace=~"${escapeRegex(namespaces)}",pod=~"${escapeRegex(names)}"}`,
  );
}

export function usageSubline(period: Period, asking = false): string {
  return `From the Prometheus set in the cluster's Settings → Metrics, over ${describePeriod(period)}. ${describeRefresh(period)}${asking ? " Asking now." : ""}`;
}
