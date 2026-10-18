import { keyOf, runningContainers } from "../shared/pods";
import { namespaceOf } from "../shared/selectors";
import type { MetricData, NodeLike, PodLike, PvcLike, ResourceList } from "../shared/types";
import { cpuCores, formatPercent, NO_DATA, quantityBytes } from "../shared/units";
import { RANK, type Verdict } from "../shared/verdict";
import { isEmpty, lastValues, type Metric } from "./series";
import type { NodeLabel, NodeQuery, PodQuery } from "./usage-queries";

export const LIMIT_RATIO = 0.9;
export const PRESSURE_RATIO = 0.9;
export const DISK_WARNING = 0.85;
export const DISK_CRITICAL = 0.95;

export type Attention = Verdict;

export function ratioOf(used: number | undefined, total: number | undefined): number | undefined {
  return used !== undefined && total ? used / total : undefined;
}

export function diskAttention(ratio: number | undefined, what: string): Attention | undefined {
  if (ratio === undefined || ratio < DISK_WARNING) return undefined;

  return {
    tone: ratio >= DISK_CRITICAL ? "critical" : "warning",
    label: "Disk nearly full",
    reason: `${what} is ${formatPercent(ratio)} full`,
  };
}

export type UsageMetrics = Partial<Record<NodeQuery | PodQuery, MetricData>>;

export interface Measure {
  used?: number;
  total?: number;
  ratio?: number;
}

export interface NodeRow {
  name: string;
  cpu: Measure;
  memory: Measure;
  /** The fullest filesystem. */
  disk: Measure & { device?: string };
  diskRead?: number;
  diskWritten?: number;
  netRx?: number;
  netTx?: number;
  /** Kubelet conditions that report pressure. */
  pressure: string[];
  attention: Attention[];
}

const hostOf = (instance: string) =>
  instance.replace(/^\[(.*)\](:\d+)?$/, "$1").replace(/:\d+$/, "");

/** An `ip:port` instance to the node with that address or name. */
export function instanceToNode(
  instance: string | undefined,
  nodes: NodeLike[],
): string | undefined {
  if (!instance) return undefined;

  const host = hostOf(instance);

  return nodes
    .find(
      (node) =>
        node.getName() === host ||
        (node.status?.addresses ?? []).some((address) => address.address === host),
    )
    ?.getName();
}

export function nodeKeyOf(
  label: NodeLabel,
  nodes: NodeLike[],
): (metric: Metric) => string | undefined {
  if (label === "instance") return (metric) => instanceToNode(metric.instance, nodes);

  return (metric) => metric[label] || undefined;
}

function fullestDisks(
  metrics: UsageMetrics,
  nodeOf: (metric: Metric) => string | undefined,
): Map<string, NodeRow["disk"]> {
  const deviceOf = (metric: Metric) => {
    const node = nodeOf(metric);

    return node && `${node}\u0000${metric.device ?? metric.mountpoint ?? ""}`;
  };
  const used = lastValues(metrics.nodeFsUsed, deviceOf, Math.max);
  const size = lastValues(metrics.nodeFsSize, deviceOf, Math.max);
  const fullest = new Map<string, NodeRow["disk"]>();

  for (const [key, total] of size) {
    const [node = "", device] = key.split("\u0000");
    const disk = {
      used: used.get(key),
      total,
      ratio: ratioOf(used.get(key), total),
      device: device || undefined,
    };
    const known = fullest.get(node);

    if (!known || (disk.ratio ?? -1) > (known.ratio ?? -1)) fullest.set(node, disk);
  }

  return fullest;
}

const PRESSURES = ["MemoryPressure", "DiskPressure", "PIDPressure"];

function nodeAttention(row: Omit<NodeRow, "attention">): Attention[] {
  const high = [
    ...(row.cpu.ratio !== undefined && row.cpu.ratio >= PRESSURE_RATIO
      ? [`CPU ${formatPercent(row.cpu.ratio)}`]
      : []),
    ...(row.memory.ratio !== undefined && row.memory.ratio >= PRESSURE_RATIO
      ? [`memory ${formatPercent(row.memory.ratio)}`]
      : []),
  ];

  const disk = diskAttention(row.disk.ratio, row.disk.device ?? "The fullest filesystem");

  return [
    ...(row.pressure.length > 0
      ? [
          {
            tone: "critical" as const,
            label: "Node pressure",
            reason: `The kubelet reports ${row.pressure.join(", ")}`,
          },
        ]
      : []),
    ...(high.length > 0
      ? [{ tone: "warning" as const, label: "Node pressure", reason: `In use: ${high.join(", ")}` }]
      : []),
    ...(disk ? [disk] : []),
  ];
}

/** Rows come from the node list, so a node without series still shows, with no data. */
export function nodeRows(nodes: NodeLike[], metrics: UsageMetrics, label: NodeLabel): NodeRow[] {
  const nodeOf = nodeKeyOf(label, nodes);
  const last = (key: NodeQuery) => lastValues(metrics[key], nodeOf);
  const cpuUsed = last("nodeCpuUsed");
  const cores = last("nodeCpuCores");
  const memoryUsed = last("nodeMemoryUsed");
  const memoryTotal = last("nodeMemoryTotal");
  const disks = fullestDisks(metrics, nodeOf);
  const reads = last("nodeDiskRead");
  const writes = last("nodeDiskWritten");
  const rx = last("nodeNetRx");
  const tx = last("nodeNetTx");

  return nodes.map((node) => {
    const name = node.getName();
    const capacity: ResourceList = node.status?.capacity ?? {};
    const totalCores = cores.get(name) ?? cpuCores(capacity.cpu);
    const totalMemory = memoryTotal.get(name) ?? quantityBytes(capacity.memory);
    const row = {
      name,
      cpu: {
        used: cpuUsed.get(name),
        total: totalCores,
        ratio: ratioOf(cpuUsed.get(name), totalCores),
      },
      memory: {
        used: memoryUsed.get(name),
        total: totalMemory,
        ratio: ratioOf(memoryUsed.get(name), totalMemory),
      },
      disk: disks.get(name) ?? {},
      diskRead: reads.get(name),
      diskWritten: writes.get(name),
      netRx: rx.get(name),
      netTx: tx.get(name),
      pressure: (node.status?.conditions ?? [])
        .filter((each) => PRESSURES.includes(each.type) && each.status === "True")
        .map((each) => each.type),
    };

    return { ...row, attention: nodeAttention(row) };
  });
}

export interface Resources {
  /** Summed over the containers that set one; undefined when none does. */
  request?: number;
  /** Undefined unless every container sets one: a single unlimited container leaves the pod unlimited. */
  limit?: number;
}

const parserOf = (resource: "cpu" | "memory") => (resource === "cpu" ? cpuCores : quantityBytes);

export function podResources(pod: PodLike, resource: "cpu" | "memory"): Resources {
  const parse = parserOf(resource);
  const containers = runningContainers(pod);
  const requests = containers.flatMap((each) => parse(each.resources?.requests?.[resource]) ?? []);
  const limits = containers.map((each) => parse(each.resources?.limits?.[resource]));

  return {
    request: requests.length > 0 ? requests.reduce((a, b) => a + b, 0) : undefined,
    limit:
      limits.length > 0 && limits.every((each) => each !== undefined)
        ? (limits as number[]).reduce((a, b) => a + b, 0)
        : undefined,
  };
}

export interface PvcUsage extends Measure {
  name: string;
}

export interface PodRow {
  key: string;
  namespace: string;
  name: string;
  node?: string;
  hostNetwork: boolean;
  cpu: Resources & { used?: number };
  memory: Resources & { used?: number };
  /** Undefined for a host-network pod: its counters are the node's. */
  netRx?: number;
  netTx?: number;
  diskIo?: number;
  pvcs: PvcUsage[];
  attention: Attention[];
}

/** The fullest volume's share; the cell's title lists every volume. */
export function describeVolumes(pvcs: PvcUsage[]): string {
  if (pvcs.length === 0) return "—";

  const ratios = pvcs.flatMap((pvc) => (pvc.ratio === undefined ? [] : [pvc.ratio]));

  return ratios.length === 0 ? NO_DATA : formatPercent(Math.max(...ratios));
}

export const podKeyOf = (metric: Metric) =>
  metric.namespace && metric.pod ? `${metric.namespace}/${metric.pod}` : undefined;

const containerKeyOf = (metric: Metric) =>
  metric.namespace && metric.pod && metric.container
    ? `${metric.namespace}/${metric.pod}/${metric.container}`
    : undefined;

export interface ContainerPeak {
  container: string;
  ratio: number;
}

/** The container closest to its own limit, the one the kernel acts on first. */
function nearestLimit(
  pod: PodLike,
  key: string,
  resource: "cpu" | "memory",
  used: Map<string, number>,
): ContainerPeak | undefined {
  const parse = parserOf(resource);

  return runningContainers(pod)
    .flatMap((container) => {
      const ratio = ratioOf(
        used.get(`${key}/${container.name}`),
        parse(container.resources?.limits?.[resource]),
      );

      return ratio === undefined ? [] : [{ container: container.name, ratio }];
    })
    .sort((a, b) => b.ratio - a.ratio)[0];
}

const pvcKeyOf = (metric: Metric) =>
  metric.namespace && metric.persistentvolumeclaim
    ? `${metric.namespace}/${metric.persistentvolumeclaim}`
    : undefined;

function podAttention(
  row: Omit<PodRow, "attention">,
  memory: ContainerPeak | undefined,
  cpu: ContainerPeak | undefined,
): Attention[] {
  return [
    ...(memory && memory.ratio >= LIMIT_RATIO
      ? [
          {
            tone: "critical" as const,
            label: "Near memory limit",
            reason: `Container ${memory.container} is at ${formatPercent(memory.ratio)} of its memory limit: the kernel kills it at 100%`,
          },
        ]
      : []),
    ...(cpu && cpu.ratio >= LIMIT_RATIO
      ? [
          {
            tone: "warning" as const,
            label: "Near CPU limit",
            reason: `Container ${cpu.container} is at ${formatPercent(cpu.ratio)} of its CPU limit: it is throttled at 100%`,
          },
        ]
      : []),
    ...row.pvcs.flatMap((pvc) => diskAttention(pvc.ratio, `Volume ${pvc.name}`) ?? []),
  ];
}

export interface PodValues {
  cpu: Map<string, number>;
  memory: Map<string, number>;
  rx: Map<string, number>;
  tx: Map<string, number>;
  disk: Map<string, number>;
  containerCpu: Map<string, number>;
  containerMemory: Map<string, number>;
  pvcUsed: Map<string, number>;
  pvcCapacity: Map<string, number>;
}

const podValuesOf = new WeakMap<UsageMetrics, PodValues>();

/** Last values per pod, container and claim; built once per answer, as pod events rebuild the rows. */
export function podValues(metrics: UsageMetrics): PodValues {
  const known = podValuesOf.get(metrics);

  if (known) return known;

  const last = (key: PodQuery) => lastValues(metrics[key], podKeyOf);
  const values = {
    cpu: last("podCpu"),
    memory: last("podMemory"),
    rx: last("podNetRx"),
    tx: last("podNetTx"),
    disk: last("podDiskIo"),
    containerCpu: lastValues(metrics.containerCpu, containerKeyOf),
    containerMemory: lastValues(metrics.containerMemory, containerKeyOf),
    pvcUsed: lastValues(metrics.pvcUsed, pvcKeyOf),
    pvcCapacity: lastValues(metrics.pvcCapacity, pvcKeyOf),
  };

  podValuesOf.set(metrics, values);

  return values;
}

function podVolumes(
  pod: PodLike,
  namespace: string,
  values: Pick<PodValues, "pvcUsed" | "pvcCapacity">,
  pvcsByKey: Map<string, PvcLike>,
): PvcUsage[] {
  return (pod.spec?.volumes ?? []).flatMap((volume) => {
    const claim = volume.persistentVolumeClaim?.claimName;

    if (!claim) return [];

    const claimKey = `${namespace}/${claim}`;
    const used = values.pvcUsed.get(claimKey);
    const total =
      values.pvcCapacity.get(claimKey) ??
      quantityBytes(pvcsByKey.get(claimKey)?.status?.capacity?.storage);

    return [{ name: claim, used, total, ratio: ratioOf(used, total) }];
  });
}

/** Rows come from the pod list: series of pods that are gone are left out. */
export function podRows(pods: PodLike[], metrics: UsageMetrics, pvcs: PvcLike[] = []): PodRow[] {
  const { cpu, memory, rx, tx, disk, containerCpu, containerMemory, pvcUsed, pvcCapacity } =
    podValues(metrics);
  const pvcsByKey = new Map(pvcs.map((pvc) => [keyOf(pvc), pvc]));

  return pods.map((pod) => {
    const namespace = namespaceOf(pod);
    const key = keyOf(pod);
    const hostNetwork = Boolean(pod.spec?.hostNetwork);
    const row = {
      key,
      namespace,
      name: pod.getName(),
      node: pod.spec?.nodeName,
      hostNetwork,
      cpu: { ...podResources(pod, "cpu"), used: cpu.get(key) },
      memory: { ...podResources(pod, "memory"), used: memory.get(key) },
      netRx: hostNetwork ? undefined : rx.get(key),
      netTx: hostNetwork ? undefined : tx.get(key),
      diskIo: disk.get(key),
      pvcs: podVolumes(pod, namespace, { pvcUsed, pvcCapacity }, pvcsByKey),
    };

    return {
      ...row,
      attention: podAttention(
        row,
        nearestLimit(pod, key, "memory", containerMemory),
        nearestLimit(pod, key, "cpu", containerCpu),
      ),
    };
  });
}

/** CPU or memory: a row with either has figures, on the page and in its drawer alike. */
export const hasUsageData = (row: { cpu: { used?: number }; memory: { used?: number } }) =>
  row.cpu.used !== undefined || row.memory.used !== undefined;

const NO_DATA_REASON = {
  node: "No node-exporter series for this node: node-exporter is not scraped on it",
  pod: "No cAdvisor series for this pod: the kubelet is not scraped, or the pod is too new",
};

/** The State cell: the worst attention, or why nothing is flagged. */
export function usageVerdict(
  attention: Attention[],
  hasData: boolean,
  kind: "node" | "pod",
): Verdict {
  const [worst] = [...attention].sort((a, b) => RANK[a.tone] - RANK[b.tone]);

  if (worst) return worst;
  if (!hasData) return { tone: "info", label: "No data", reason: NO_DATA_REASON[kind] };

  return { tone: "ok", label: "Fine", reason: "Below every threshold" };
}

export type PodMetric = "cpu" | "memory" | "netRx" | "netTx" | "diskIo";

export type Unit = "cores" | "bytes" | "rate";

/** What the Pods page can chart, the query behind it and the column it ranks by. */
export const POD_METRICS: Record<
  PodMetric,
  { label: string; query: PodQuery; unit: Unit; value: (row: PodRow) => number | undefined }
> = {
  cpu: { label: "CPU", query: "podCpu", unit: "cores", value: (row) => row.cpu.used },
  memory: { label: "Memory", query: "podMemory", unit: "bytes", value: (row) => row.memory.used },
  netRx: { label: "Net rx", query: "podNetRx", unit: "rate", value: (row) => row.netRx },
  netTx: { label: "Net tx", query: "podNetTx", unit: "rate", value: (row) => row.netTx },
  diskIo: { label: "Disk I/O", query: "podDiskIo", unit: "rate", value: (row) => row.diskIo },
};

export const POD_METRIC_IDS = Object.keys(POD_METRICS) as PodMetric[];

/** The busiest pods by one measure; a pod without that value is left out. */
export function topPods(rows: PodRow[], metric: PodMetric, limit: number): PodRow[] {
  const { value } = POD_METRICS[metric];

  return rows
    .filter((row) => value(row) !== undefined)
    .sort((a, b) => (value(b) ?? 0) - (value(a) ?? 0) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export interface NodeChart {
  id: string;
  title: string;
  /** Added together per node. */
  queries: NodeQuery[];
  unit: Unit;
}

export const NODE_CHARTS: readonly NodeChart[] = [
  { id: "cpu", title: "CPU used", queries: ["nodeCpuUsed"], unit: "cores" },
  { id: "memory", title: "Memory used", queries: ["nodeMemoryUsed"], unit: "bytes" },
  { id: "disk", title: "Filesystem used", queries: ["nodeFsUsed"], unit: "bytes" },
  { id: "network", title: "Network rx + tx", queries: ["nodeNetRx", "nodeNetTx"], unit: "rate" },
];

export function chartQueries(charts: readonly NodeChart[]): NodeQuery[] {
  return [...new Set(charts.flatMap((chart) => chart.queries))];
}

export type UsageState = "ready" | "no-node-metrics" | "not-configured";

/** Every probe empty means the cluster's metrics setting reaches no Prometheus with these series. */
export function usageState(
  probes: (MetricData | undefined)[],
  podCpu: MetricData | undefined,
): UsageState {
  if (probes.some((probe) => !isEmpty(probe))) return "ready";

  return isEmpty(podCpu) ? "not-configured" : "no-node-metrics";
}

export function describeUsageState(state: UsageState): string | undefined {
  if (state === "not-configured") {
    return "No answer from a Prometheus for this cluster. Check the cluster's Settings → Metrics, then press Refresh.";
  }
  if (state === "no-node-metrics") {
    return "No node-exporter series reach this cluster's Prometheus, so the Nodes page has no data.";
  }

  return undefined;
}

export function describeMixedClusters(clusters: string[]): string | undefined {
  if (clusters.length < 2) return undefined;

  return `This Prometheus holds series from ${clusters.length} clusters (${clusters.join(", ")}), so same-named nodes and pods add up across them. Point Settings → Metrics at a tenant for this cluster alone, or at a prom-label-proxy that adds its cluster label.`;
}

/** A host answer of `{}` and a thrown read both fail; only "success" carries series. */
export const failedAnswer = (data: MetricData | undefined) =>
  data !== undefined && data.status !== "success";

/** In place of a chart with no line: still asking, refused, or answered with no series. */
export function chartNote(answers: (MetricData | undefined)[], answered: boolean): string {
  if (!answered) return "Asking Prometheus.";

  const failed = answers.find(failedAnswer);

  if (failed) return `Prometheus did not answer${failed.error ? `: ${failed.error}` : "."}`;

  return "No series in this window.";
}
