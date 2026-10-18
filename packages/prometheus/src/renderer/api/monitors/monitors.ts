import type { HostKind } from "../shared/host-links";
import type { Rejection } from "../shared/rejections";
import {
  describeSource,
  monitorSelection,
  namespaceLabelsOf,
  rejectionOf,
  type Selection,
  type Source,
  selectionDecision,
  unreadError,
} from "../shared/selection";
import {
  describeSelector,
  monitorLooksIn,
  monitorTargetNamespaces,
  namespaceOf,
  objectKey,
  type TargetNamespaces,
} from "../shared/selectors";
import type { MonitorKind, MonitorLike, NamespaceLike } from "../shared/types";
import { MONITOR_LOOK, type MonitorState, plural, type Verdict } from "../shared/verdict";
import {
  emptyHealth,
  type Health,
  healthByMonitor,
  type PrometheusRead,
  parsePool,
  poolsLoaded,
} from "./scrape-pools";
import {
  type CheckState,
  type EndpointCheck,
  indexObjects,
  type KubernetesObjects,
  kubernetesChecks,
  type ObjectIndex,
  worstCheck,
} from "./targets";

export const targetNoun = (kind: MonitorKind) => (kind === "PodMonitor" ? "pod" : "Service");

export const targetHostKind = (kind: MonitorKind): HostKind =>
  kind === "PodMonitor" ? "Pod" : "Service";

export const staticTargets = (monitor: MonitorLike) =>
  (monitor.spec.staticConfigs ?? []).flatMap((each) => each.targets ?? []);

export interface MonitorInventory extends KubernetesObjects {
  serviceMonitors: MonitorLike[];
  podMonitors: MonitorLike[];
  scrapeConfigs: MonitorLike[];
  namespaces: NamespaceLike[];
  sources: Source[];
  rejections: Map<string, Rejection>;
  /** One per Prometheus, agent or TargetAllocator read; a source with none is unknown. */
  reads: PrometheusRead[];
  /** False while the Kubernetes lists hold another scope's objects: the checks wait. */
  targetsLoaded?: boolean;
}

/** What one selecting source said about the monitor; a TargetAllocator tells only its job names. */
export interface LiveView {
  source: Source;
  /** Undefined when it could not be read. */
  loaded?: boolean;
  /** Undefined for a TargetAllocator: its collector scrapes. */
  health?: Health;
  error?: string;
}

export interface MonitorRow {
  key: string;
  kind: MonitorKind;
  name: string;
  namespace: string;
  monitor: MonitorLike;
  selection: Selection;
  /** Where the Kubernetes checks look, over every source that selects it. */
  looksIn: TargetNamespaces;
  checks: EndpointCheck[];
  rejection?: string;
  live: LiveView[];
  /** Summed over the sources read; undefined when none was. */
  health?: Health;
  state: MonitorState;
  verdict: Verdict;
}

/** A read with its pools and targets indexed by monitor. */
export interface IndexedRead {
  read: PrometheusRead;
  loaded?: Map<string, Set<number | undefined>>;
  health?: Map<string, Health>;
}

// A read is replaced, never changed, when its source answers again, so it is indexed once.
const indexedReads = new WeakMap<PrometheusRead, IndexedRead>();

export function indexedRead(read: PrometheusRead): IndexedRead {
  const known = indexedReads.get(read);

  if (known) return known;

  const indexed = {
    read,
    loaded: read.pools && poolsLoaded(read.pools),
    health: read.targets && healthByMonitor(read.targets),
  };

  indexedReads.set(read, indexed);

  return indexed;
}

const indexReads = (reads: PrometheusRead[]) =>
  new Map(reads.map((read) => [read.source, indexedRead(read)]));

function liveViewOf(source: Source, key: string, reads: Map<string, IndexedRead>): LiveView {
  const indexed = reads.get(source.key);
  const unread = unreadError(source, indexed?.read);

  if (unread || !indexed) return { source, error: unread };

  return {
    source,
    loaded: indexed.loaded?.has(key),
    health: indexed.health && (indexed.health.get(key) ?? emptyHealth()),
  };
}

function sumHealth(views: LiveView[]): Health | undefined {
  const read = views.flatMap((view) => view.health ?? []);

  if (read.length === 0) return undefined;

  const total = (count: (health: Health) => number) =>
    read.reduce((sum, health) => sum + count(health), 0);

  return {
    up: total((health) => health.up),
    down: total((health) => health.down),
    unknown: total((health) => health.unknown),
    errors: read.flatMap((health) => health.errors),
    targets: read.flatMap((health) => health.targets),
  };
}

function targetPlaces(row: Pick<MonitorRow, "looksIn">): string {
  return row.looksIn.any ? "any namespace" : row.looksIn.names.join(", ");
}

const isAllocator = (view: LiveView) => view.source.kind === "TargetAllocator";

const sourceNames = (views: LiveView[]) =>
  views.map((view) => describeSource(view.source)).join(", ");

function notLoadedReason(read: LiveView[]): string {
  const instances = read.filter((view) => !isAllocator(view));
  const allocators = read.filter(isAllocator);

  return [
    ...(instances.length > 0 ? [`${sourceNames(instances)} has no scrape pool for it`] : []),
    ...(allocators.length > 0
      ? [`${sourceNames(allocators)} has no job for it, so it was not loaded or discovered nothing`]
      : []),
    "its Events or logs say why",
  ].join("; ");
}

// A Kubernetes check that finds nothing where a target is up read lists that are behind.
function endpointsUp(health: Health | undefined): Set<number> {
  return new Set(
    (health?.targets ?? []).flatMap((target) => {
      const index = target.health === "up" ? parsePool(target.scrapePool)?.index : undefined;

      return index === undefined ? [] : [index];
    }),
  );
}

const OUTRUN_BY_TARGETS: readonly CheckState[] = ["no-target", "no-endpoints"];

type Decision = { state: MonitorState; reason: string };

function decide(row: Omit<MonitorRow, "state" | "verdict">): Decision {
  const unselected = selectionDecision(
    row,
    "No Prometheus, agent or TargetAllocator selects its labels",
  );

  if (unselected) return unselected;

  const up = endpointsUp(row.health);
  const behind = row.checks.filter(
    (check) => OUTRUN_BY_TARGETS.includes(check.state) && up.has(check.index),
  );
  const worst = worstCheck(row.checks.filter((check) => !behind.includes(check)));
  const what = targetNoun(row.kind);

  if (worst?.state === "no-target") {
    return {
      state: "no-target",
      reason: `No ${what} in ${targetPlaces(row)} matches ${describeSelector(row.monitor.spec.selector)}`,
    };
  }
  if (worst?.state === "port-missing") {
    return {
      state: "port-missing",
      reason: `No matched ${what} has a port named ${worst.port}; ${worst.portNames.length > 0 ? `they have ${worst.portNames.join(", ")}` : "they name no port"}`,
    };
  }
  if (worst?.state === "no-endpoints") {
    return {
      state: "no-endpoints",
      reason: `${worst.withPort.join(", ")} ${worst.withPort.length === 1 ? "has" : "have"} ${row.kind === "PodMonitor" ? "no pod IP" : `no endpoint on port ${worst.port}`}`,
    };
  }

  const read = row.live.filter((view) => !view.error);

  if (read.length === 0) {
    return { state: "unknown", reason: row.live.map((view) => view.error).join("; ") };
  }

  const health = row.health;

  if (health && health.down > 0) {
    const total = health.up + health.down + health.unknown;
    const first = health.errors[0]?.lastError;

    return {
      state: "down",
      reason: `${health.down} of ${plural(total, "target")} down${first ? `: ${first}` : ""}`,
    };
  }
  if (read.every((view) => view.loaded === false)) {
    return { state: "not-loaded", reason: notLoadedReason(read) };
  }
  if (health && health.up > 0) {
    return {
      state: "healthy",
      reason: `${plural(health.up, "target")} up${behind.length > 0 ? ", though the Kubernetes check finds nothing to scrape; the lists it read may be behind" : ""}`,
    };
  }
  if (health && health.unknown > 0) {
    return { state: "unknown", reason: `${plural(health.unknown, "target")} not scraped yet` };
  }

  const allocated = read.filter((view) => isAllocator(view) && view.loaded);

  if (allocated.length > 0) {
    return {
      state: "unknown",
      reason: `${sourceNames(allocated)} has a job for it; its targets' health is in the collector`,
    };
  }
  if (!health) return { state: "unknown", reason: "The targets were not read" };

  return { state: "no-target", reason: "Prometheus loaded it but discovered no target" };
}

function rowOf(
  kind: MonitorKind,
  monitor: MonitorLike,
  inventory: MonitorInventory,
  namespaceLabels: ReturnType<typeof namespaceLabelsOf>,
  reads: Map<string, IndexedRead>,
  objects: ObjectIndex | undefined,
): MonitorRow {
  const namespace = namespaceOf(monitor);
  const key = objectKey(kind, namespace, monitor.getName());
  const selection = monitorSelection(monitor, kind, inventory.sources, namespaceLabels);
  const looksIn = monitorLooksIn(
    monitor.spec.namespaceSelector,
    namespace,
    selection.selectedBy.map((source) => source.ignoreNamespaceSelectors),
  );
  const live = selection.selectedBy.map((source) => liveViewOf(source, key, reads));
  // A TargetAllocator does not apply the operator's checks, so its job proves nothing here.
  const loaded = live.some((view) => view.loaded === true && !isAllocator(view));
  const partial = {
    key,
    kind,
    name: monitor.getName(),
    namespace,
    monitor,
    selection,
    looksIn,
    checks: objects ? kubernetesChecks(kind, monitor, inventory, looksIn, objects) : [],
    rejection: rejectionOf(inventory.rejections.get(key), monitor.metadata.uid, loaded, selection),
    live,
    health: sumHealth(live),
  };
  const { state, reason } = decide(partial);

  return { ...partial, state, verdict: { ...MONITOR_LOOK[state], reason } };
}

export function monitorRows(inventory: MonitorInventory): MonitorRow[] {
  const namespaceLabels = namespaceLabelsOf(inventory.namespaces);
  const reads = indexReads(inventory.reads);
  const objects = inventory.targetsLoaded === false ? undefined : indexObjects(inventory);
  const each = (kind: MonitorKind, monitors: MonitorLike[]) =>
    monitors.map((monitor) => rowOf(kind, monitor, inventory, namespaceLabels, reads, objects));

  return [
    ...each("ServiceMonitor", inventory.serviceMonitors),
    ...each("PodMonitor", inventory.podMonitors),
    ...each("ScrapeConfig", inventory.scrapeConfigs),
  ];
}

/** Where each monitor looks, its own namespace when a source ignores selectors, and each source's own. */
export function lookupNamespaces(
  monitors: MonitorLike[],
  sources: Source[],
  every: readonly string[],
): string[] {
  const names = new Set(sources.map((source) => source.namespace));
  const ignored = sources.some((source) => source.ignoreNamespaceSelectors);

  for (const monitor of monitors) {
    const target = monitorTargetNamespaces(monitor.spec.namespaceSelector, namespaceOf(monitor));

    for (const name of target.any ? every : target.names) names.add(name);
    if (ignored) names.add(namespaceOf(monitor));
  }

  return [...names].sort();
}

const WIDE_LOOKUP = 20;

/** Half the namespaces or more than 20 cost less as one cluster-wide list and watch per kind. */
export function lookupScope(lookup: readonly string[], every: readonly string[]): string[] {
  if (lookup.length === 0) return [];
  if (lookup.length <= WIDE_LOOKUP && lookup.length * 2 < every.length) return [...lookup];

  // The host lists and watches cluster-wide once every namespace is asked for.
  return [...new Set([...every, ...lookup])].sort();
}

export type MonitorFilter =
  | "attention"
  | "not-selected"
  | "no-target"
  | "down"
  | "rejected"
  | "healthy"
  | "unknown";

const FILTER_STATES: Record<MonitorFilter, readonly MonitorState[]> = {
  attention: [
    "rejected",
    "not-selected",
    "namespace-excluded",
    "no-target",
    "port-missing",
    "no-endpoints",
    "down",
    "not-loaded",
  ],
  "not-selected": ["not-selected", "namespace-excluded"],
  "no-target": ["no-target", "port-missing", "no-endpoints"],
  down: ["down"],
  rejected: ["rejected", "not-loaded"],
  healthy: ["healthy"],
  unknown: ["unknown"],
};

export const MONITOR_FILTERS = Object.keys(FILTER_STATES) as MonitorFilter[];

/** Each filter chip's tooltip; the Overview's cards reuse them. */
export const MONITOR_FILTER_TITLES: Record<MonitorFilter, string> = {
  attention: "Shows every monitor that is not selected, finds no target, is down or was refused",
  "not-selected": "Shows monitors no Prometheus, agent or TargetAllocator takes",
  "no-target": "Shows monitors whose selector, port or endpoints reach nothing",
  down: "Shows monitors with a target Prometheus cannot scrape",
  rejected: "Shows monitors the operator refused or Prometheus has no scrape pool for",
  healthy: "Shows monitors whose targets are all up",
  unknown: "Shows monitors no Prometheus that selects them could tell about",
};

export function matchesMonitorFilter(row: MonitorRow, filter: MonitorFilter | undefined): boolean {
  return !filter || FILTER_STATES[filter].includes(row.state);
}

export function isMonitorFilter(value: string | undefined): value is MonitorFilter {
  return value !== undefined && value in FILTER_STATES;
}
