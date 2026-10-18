import { KubeObject } from "@freelensapp/kube-object";
import { type AlertingRead, mergeAlerting } from "../../src/renderer/api/instances/instances";
import type { MonitorInventory } from "../../src/renderer/api/monitors/monitors";
import { mergeShards, type PrometheusRead } from "../../src/renderer/api/monitors/scrape-pools";
import type { RuleInventory } from "../../src/renderer/api/rules/rules";
import {
  Alertmanager,
  OpenTelemetryCollector,
  PodMonitor,
  Prometheus,
  PrometheusAgent,
  PrometheusRule,
  ScrapeConfig,
  ServiceMonitor,
} from "../../src/renderer/api/shared/kinds";
import {
  parseAlertmanagers,
  parseAllocatorJobs,
  parsePools,
  parseRules,
  parseTargets,
} from "../../src/renderer/api/shared/prometheus-api";
import { rejectionsFrom } from "../../src/renderer/api/shared/rejections";
import { type Source, selectorSources } from "../../src/renderer/api/shared/selection";
import { objectKey } from "../../src/renderer/api/shared/selectors";
import type {
  AlertmanagerLike,
  CollectorLike,
  EndpointSliceLike,
  EventLike,
  MetricData,
  MonitorLike,
  NamespaceLike,
  NodeLike,
  PodLike,
  PrometheusLike,
  PvcLike,
  RuleLike,
  ServiceLike,
} from "../../src/renderer/api/shared/types";

import agentsJson from "../fixtures/agents.json";
import alertmanagersJson from "../fixtures/alertmanagers.json";
import collectorsJson from "../fixtures/collectors.json";
import endpointSlicesJson from "../fixtures/endpoint-slices.json";
import eventsJson from "../fixtures/events.json";
import exportedAt from "../fixtures/exported-at.json";
import namespacesJson from "../fixtures/namespaces.json";
import nodesJson from "../fixtures/nodes.json";
import podMonitorsJson from "../fixtures/pod-monitors.json";
import podsJson from "../fixtures/pods.json";
import alertmanagersApiJson from "../fixtures/prometheus-alertmanagers.json";
import rulesJson from "../fixtures/prometheus-rules.json";
import liveRulesJson from "../fixtures/prometheus-rules-live.json";
import targetsJson from "../fixtures/prometheus-targets.json";
import prometheusesJson from "../fixtures/prometheuses.json";
import pvcsJson from "../fixtures/pvcs.json";
import scrapeConfigsJson from "../fixtures/scrape-configs.json";
import poolsJson from "../fixtures/scrape-pools.json";
import serviceMonitorsJson from "../fixtures/service-monitors.json";
import servicesJson from "../fixtures/services.json";
import allocatorJobsJson from "../fixtures/targetallocator-jobs.json";
import usageJson from "../fixtures/usage-metrics.json";

type Raw = { items: unknown[] };

function build<T>(Kind: new (data: never) => unknown, json: unknown): T[] {
  return (json as Raw).items.map((item) => new Kind(item as never) as T);
}

export const NOW = Date.parse(exportedAt.exportedAt);

export const serviceMonitors = () => build<MonitorLike>(ServiceMonitor, serviceMonitorsJson);
export const podMonitors = () => build<MonitorLike>(PodMonitor, podMonitorsJson);
export const scrapeConfigs = () => build<MonitorLike>(ScrapeConfig, scrapeConfigsJson);
export const prometheusRules = () => build<RuleLike>(PrometheusRule, rulesJson);
export const prometheuses = () => build<PrometheusLike>(Prometheus, prometheusesJson);
export const agents = () => build<PrometheusLike>(PrometheusAgent, agentsJson);
export const alertmanagers = () => build<AlertmanagerLike>(Alertmanager, alertmanagersJson);
export const collectors = () => build<CollectorLike>(OpenTelemetryCollector, collectorsJson);
export const services = () => build<ServiceLike>(KubeObject, servicesJson);
export const endpointSlices = () => build<EndpointSliceLike>(KubeObject, endpointSlicesJson);
export const pods = () => build<PodLike>(KubeObject, podsJson);
export const namespaces = () => build<NamespaceLike>(KubeObject, namespacesJson);
export const nodes = () => build<NodeLike>(KubeObject, nodesJson);
export const pvcs = () => build<PvcLike>(KubeObject, pvcsJson);

/** Plain JSON, as the events list answers. */
export const events = () => structuredClone((eventsJson as { items: EventLike[] }).items);

export const sources = (): Source[] => selectorSources(prometheuses(), agents(), collectors());

export function sourceNamed(key: string): Source {
  const found = sources().find((each) => each.key === key);

  if (!found) throw new Error(`no source ${key} in the fixture`);

  return found;
}

type ApiItem = { namespace: string; pod: string } & Record<string, unknown>;

const answers = (json: unknown, key: string) =>
  (json as { items: ApiItem[] }).items.map((item) => ({ ...item, body: item[key] }));

// The exported answers name the pod they came from; its operator label names the Prometheus.
function prometheusOfPod(namespace: string, pod: string): string {
  const found = pods().find((each) => each.getNs() === namespace && each.getName() === pod);
  const name = found?.metadata.labels?.["operator.prometheus.io/name"];

  if (!name) throw new Error(`no Prometheus pod ${namespace}/${pod} in the fixture`);

  return objectKey("Prometheus", namespace, name);
}

type JobsItem = { namespace: string; collector: string; jobs: unknown };

/** Each TargetAllocator's exported /jobs, read as the page reads it. */
export function allocatorReads(): PrometheusRead[] {
  return (structuredClone(allocatorJobsJson) as { items: JobsItem[] }).items.map((item) => ({
    source: objectKey("TargetAllocator", item.namespace, item.collector),
    pools: parseAllocatorJobs(item.jobs),
  }));
}

/** The exported API answers, parsed and merged per Prometheus, then each TargetAllocator's jobs. */
export function reads(): PrometheusRead[] {
  const targets = answers(targetsJson, "targets");
  const pools = answers(poolsJson, "scrapePools");
  const rules = answers(liveRulesJson, "rules");
  const bySource = new Map<
    string,
    {
      pools?: string[];
      targets?: ReturnType<typeof parseTargets>;
      groups?: ReturnType<typeof parseRules>;
    }[]
  >();

  for (const item of targets) {
    const key = prometheusOfPod(item.namespace, item.pod);
    const pool = pools.find((each) => each.pod === item.pod && each.namespace === item.namespace);
    const rule = rules.find((each) => each.pod === item.pod && each.namespace === item.namespace);

    bySource.set(key, [
      ...(bySource.get(key) ?? []),
      {
        targets: parseTargets(item.body),
        pools: pool && parsePools(pool.body),
        groups: rule && parseRules(rule.body),
      },
    ]);
  }

  return [...[...bySource].map(([key, shards]) => mergeShards(key, shards)), ...allocatorReads()];
}

/** reads(), as a Prometheus that has reloaded a changed monitor answers: no target left in its pool. */
export function readsWithoutTargetsOf(pool: string): PrometheusRead[] {
  return reads().map((read) => ({
    ...read,
    targets: read.targets?.filter((target) => !target.scrapePool.includes(pool)),
  }));
}

/** Each Prometheus's exported /api/v1/alertmanagers, read as the Instances page reads it. */
export function alertingReads(): AlertingRead[] {
  const bySource = new Map<string, { active: string[] }[]>();

  for (const item of answers(alertmanagersApiJson, "alertmanagers")) {
    const key = prometheusOfPod(item.namespace, item.pod);

    bySource.set(key, [...(bySource.get(key) ?? []), { active: parseAlertmanagers(item.body) }]);
  }

  return [...bySource].map(([key, shards]) => mergeAlerting(key, shards));
}

export const alertmanagersBody = () => answers(alertmanagersApiJson, "alertmanagers")[0]?.body;
export const targetsBody = () => answers(targetsJson, "targets")[0]?.body;
export const rulesBody = () => answers(liveRulesJson, "rules")[0]?.body;
export const poolsBody = () => answers(poolsJson, "scrapePools")[0]?.body;

export function monitorInventory(change: Partial<MonitorInventory> = {}): MonitorInventory {
  return {
    serviceMonitors: serviceMonitors(),
    podMonitors: podMonitors(),
    scrapeConfigs: scrapeConfigs(),
    services: services(),
    endpointSlices: endpointSlices(),
    pods: pods(),
    namespaces: namespaces(),
    sources: sources(),
    rejections: rejectionsFrom(events()),
    reads: reads(),
    ...change,
  };
}

export function ruleInventory(change: Partial<RuleInventory> = {}): RuleInventory {
  return {
    rules: prometheusRules(),
    namespaces: namespaces(),
    sources: sources(),
    rejections: rejectionsFrom(events()),
    reads: reads(),
    ...change,
  };
}

export function named<T extends { getName(): string; getNs(): string | undefined }>(
  items: T[],
  key: string,
): T {
  const found = items.find((each) => `${each.getNs() ?? ""}/${each.getName()}` === key);

  if (!found) throw new Error(`no ${key} in the fixture`);

  return found;
}

/** A real object, deep-cloned, with only the field under test changed. */
export function variant<T>(object: T, change: (data: T) => void): T {
  const data = (object as unknown as KubeObject).toPlainObject() as unknown as T;

  change(data);

  const Kind = (object as unknown as { constructor: new (data: T) => T }).constructor;

  return new Kind(data);
}

export interface UsageItem {
  key: string;
  query: string;
  start: number;
  end: number;
  step: number;
  response: MetricData;
}

export const usageItems = () => structuredClone((usageJson as { items: UsageItem[] }).items);

export function usageMetrics(): Record<string, MetricData> {
  return Object.fromEntries(usageItems().map((item) => [item.key, item.response]));
}

export function usageItem(key: string): UsageItem {
  const found = usageItems().find((item) => item.key === key);

  if (!found) throw new Error(`no usage query ${key} in the fixture`);

  return found;
}
