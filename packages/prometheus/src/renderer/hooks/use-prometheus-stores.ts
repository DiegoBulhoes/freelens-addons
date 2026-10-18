import { Renderer } from "@freelensapp/extensions";
import { useMemo } from "react";
import { lookupNamespaces, lookupScope } from "../api/monitors/monitors";
import { ruleReadNamespaces } from "../api/rules/rules";
import {
  Alertmanager,
  OpenTelemetryCollector,
  PodMonitor,
  Prometheus,
  PrometheusAgent,
  PrometheusRule,
  ScrapeConfig,
  ServiceMonitor,
} from "../api/shared/kinds";
import { scopeKey, withinScope } from "../api/shared/namespace-scope";
import { type Source, selectorSources } from "../api/shared/selection";
import { type LoadState, loadedForScope, loadState } from "../api/shared/store-state";
import type {
  AlertmanagerLike,
  CollectorLike,
  EndpointSliceLike,
  MonitorLike,
  NamespaceLike,
  PodLike,
  PrometheusLike,
  RuleLike,
  ServiceLike,
} from "../api/shared/types";
import { useKubeStore } from "../components/use-kube-store";
import { inNamespaces, type LoadableStore, useLoadedStores, useScopedLoad } from "./load-stores";
import { useNamespaceScope } from "./use-namespace-scope";

export interface PrometheusStores {
  /** In the namespaces in scope. */
  serviceMonitors: MonitorLike[];
  podMonitors: MonitorLike[];
  scrapeConfigs: MonitorLike[];
  rules: RuleLike[];
  prometheuses: PrometheusLike[];
  agents: PrometheusLike[];
  alertmanagers: AlertmanagerLike[];
  /** In every namespace: a selector in one namespace takes objects in others. */
  sources: Source[];
  allPrometheuses: PrometheusLike[];
  allAgents: PrometheusLike[];
  namespaces: NamespaceLike[];
  /** Where the monitors look and the sources run; empty unless asked for. */
  services: ServiceLike[];
  endpointSlices: EndpointSliceLike[];
  pods: PodLike[];
  /** False while Services, EndpointSlices or pods hold another scope's items. */
  targetsLoaded: boolean;
  scope: readonly string[];
  state: LoadState;
}

type Store = { items: unknown[]; isLoaded: boolean } & LoadableStore;

const itemsOf = <T>(store: { items: unknown[] } | undefined) =>
  (store?.items ?? []) as unknown as T[];

/** `targets`: Services, EndpointSlices and pods for the checks; `pods`: the Prometheus pods to query. */
export function usePrometheusStores({
  targets: targetObjects,
  pods: prometheusPods,
}: {
  targets: boolean;
  pods: boolean;
}): PrometheusStores {
  // Each registers only once its CRD exists; a missing one must not hold the others back.
  const serviceMonitorStore = useKubeStore(() => ServiceMonitor.getStore<ServiceMonitor>());
  const podMonitorStore = useKubeStore(() => PodMonitor.getStore<PodMonitor>());
  const scrapeConfigStore = useKubeStore(() => ScrapeConfig.getStore<ScrapeConfig>());
  const ruleStore = useKubeStore(() => PrometheusRule.getStore<PrometheusRule>());
  const prometheusStore = useKubeStore(() => Prometheus.getStore<Prometheus>());
  const agentStore = useKubeStore(() => PrometheusAgent.getStore<PrometheusAgent>());
  const alertmanagerStore = useKubeStore(() => Alertmanager.getStore<Alertmanager>());
  const collectorStore = useKubeStore(() =>
    OpenTelemetryCollector.getStore<OpenTelemetryCollector>(),
  );
  const scope = useNamespaceScope();
  const key = scopeKey(scope);
  const { endpointSliceStore, namespaceStore, podsStore, serviceStore } = Renderer.K8sApi;
  const namespaces = itemsOf<NamespaceLike>(namespaceStore);
  const every = namespaces.length > 0 ? namespaces.map((namespace) => namespace.getName()) : scope;
  const everyKey = scopeKey(every);

  const prometheusesEverywhere = useMemo(
    () => inNamespaces(prometheusStore, everyKey),
    [prometheusStore, everyKey],
  );
  const agentsEverywhere = useMemo(
    () => inNamespaces(agentStore, everyKey),
    [agentStore, everyKey],
  );
  const alertmanagersEverywhere = useMemo(
    () => inNamespaces(alertmanagerStore, everyKey),
    [alertmanagerStore, everyKey],
  );
  const collectorsEverywhere = useMemo(
    () => inNamespaces(collectorStore, everyKey),
    [collectorStore, everyKey],
  );

  const allPrometheuses = itemsOf<PrometheusLike>(prometheusStore);
  const allAgents = itemsOf<PrometheusLike>(agentStore);
  const collectors = itemsOf<CollectorLike>(collectorStore);
  const sources = selectorSources(allPrometheuses, allAgents, collectors);
  const inScope = <T extends { getNs(): string | undefined }>(
    store: { items: unknown[] } | undefined,
  ) => withinScope(itemsOf<T>(store), scope);
  const serviceMonitors = inScope<MonitorLike>(serviceMonitorStore);
  const podMonitors = inScope<MonitorLike>(podMonitorStore);
  const lookup = targetObjects
    ? lookupNamespaces([...serviceMonitors, ...podMonitors], sources, every)
    : prometheusPods
      ? ruleReadNamespaces(sources)
      : [];
  const lookupKey = scopeKey(lookupScope(lookup, every));
  const servicesThere = useMemo(
    () => (targetObjects ? inNamespaces(serviceStore, lookupKey) : undefined),
    [targetObjects, serviceStore, lookupKey],
  );
  const slicesThere = useMemo(
    () => (targetObjects ? inNamespaces(endpointSliceStore, lookupKey) : undefined),
    [targetObjects, endpointSliceStore, lookupKey],
  );
  const podsThere = useMemo(
    () => (targetObjects || prometheusPods ? inNamespaces(podsStore, lookupKey) : undefined),
    [targetObjects, prometheusPods, podsStore, lookupKey],
  );

  const servicesLoad = useScopedLoad([servicesThere], lookupKey);
  const slicesLoad = useScopedLoad([slicesThere], lookupKey);
  const podsLoad = useScopedLoad([podsThere], lookupKey);
  const gaveUp = [
    useLoadedStores([serviceMonitorStore], key),
    useLoadedStores([podMonitorStore], key),
    useLoadedStores([scrapeConfigStore], key),
    useLoadedStores([ruleStore], key),
    useLoadedStores([prometheusesEverywhere], everyKey),
    useLoadedStores([agentsEverywhere], everyKey),
    useLoadedStores([alertmanagersEverywhere], everyKey),
    useLoadedStores([collectorsEverywhere], everyKey),
    useLoadedStores([namespaceStore]),
    servicesLoad.gaveUp,
    slicesLoad.gaveUp,
    podsLoad.gaveUp,
  ].some(Boolean);

  // A kind whose CRD is missing never registers, and is left out rather than waited for.
  const crdStores = [
    serviceMonitorStore,
    podMonitorStore,
    scrapeConfigStore,
    ruleStore,
    prometheusStore,
    agentStore,
    alertmanagerStore,
  ] as unknown as (Store | undefined)[];
  const registered = crdStores.filter((store): store is Store => Boolean(store));
  const hostWanted = [
    ...(targetObjects
      ? [
          { isLoaded: serviceStore.isLoaded, loadedFor: servicesLoad.loadedFor },
          { isLoaded: endpointSliceStore.isLoaded, loadedFor: slicesLoad.loadedFor },
        ]
      : []),
    ...(targetObjects || prometheusPods
      ? [{ isLoaded: podsStore.isLoaded, loadedFor: podsLoad.loadedFor }]
      : []),
  ];
  // With no namespace to look in, there is nothing to wait for.
  const hostLoaded = loadedForScope(hostWanted, lookupKey);
  const loaded = registered.length > 0 && registered.every((store) => store.isLoaded);
  const rules = inScope<RuleLike>(ruleStore);
  const scrapeConfigs = inScope<MonitorLike>(scrapeConfigStore);

  return {
    serviceMonitors,
    podMonitors,
    scrapeConfigs,
    rules,
    prometheuses: withinScope(allPrometheuses, scope),
    agents: withinScope(allAgents, scope),
    alertmanagers: inScope<AlertmanagerLike>(alertmanagerStore),
    sources,
    allPrometheuses,
    allAgents,
    namespaces,
    services: targetObjects ? itemsOf<ServiceLike>(serviceStore) : [],
    endpointSlices: targetObjects ? itemsOf<EndpointSliceLike>(endpointSliceStore) : [],
    pods: targetObjects || prometheusPods ? itemsOf<PodLike>(podsStore) : [],
    targetsLoaded: hostLoaded,
    scope,
    state: loadState({
      registered: registered.length > 0,
      loaded: loaded && hostLoaded,
      itemCount: hostLoaded
        ? serviceMonitors.length + podMonitors.length + scrapeConfigs.length + rules.length
        : 0,
      gaveUp,
    }),
  };
}
