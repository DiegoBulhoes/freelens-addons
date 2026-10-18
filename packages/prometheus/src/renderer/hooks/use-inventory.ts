import { type InstanceRow, instanceRows } from "../api/instances/instances";
import { type MonitorRow, monitorRows } from "../api/monitors/monitors";
import type { PrometheusRead } from "../api/monitors/scrape-pools";
import { type RuleRow, ruleRows } from "../api/rules/rules";
import { type LiveState, liveState } from "../api/shared/live-reads";
import type { Rejection } from "../api/shared/rejections";
import { namespaceOf } from "../api/shared/selectors";
import { useAlerting, useLive, useRejections } from "./use-live";
import { type PrometheusStores, usePrometheusStores } from "./use-prometheus-stores";

export interface Inventory {
  stores: PrometheusStores;
  monitors: MonitorRow[];
  rules: RuleRow[];
  instances: InstanceRow[];
  reads: PrometheusRead[];
  rejections: Map<string, Rejection>;
  /** Namespaces whose Events could not be read. */
  eventsRefused: string[];
  /** On the page as `data-live`, for the e2e suites to wait on. */
  live: LiveState;
}

/** Each flag reads only what its page shows: monitor and rule rows with their Events, or each Prometheus's Alertmanagers. */
export function useInventory({
  monitors,
  rules,
  alerting = false,
}: {
  monitors: boolean;
  rules: boolean;
  alerting?: boolean;
}): Inventory {
  const stores = usePrometheusStores({ targets: monitors, pods: rules || alerting });
  const live = monitors || rules;
  // An agent holds no rules, and on Rules alone its pods are not loaded.
  const { reads, asked } = useLive(
    live,
    stores.allPrometheuses,
    monitors ? stores.allAgents : [],
    monitors ? stores.sources : [],
    stores.pods,
  );
  const { reads: alertingReads, asked: alertingAsked } = useAlerting(
    alerting,
    stores.allPrometheuses,
    stores.pods,
  );
  const watched = [
    ...(monitors
      ? [...stores.serviceMonitors, ...stores.podMonitors, ...stores.scrapeConfigs]
      : []),
    ...(rules ? stores.rules : []),
  ];
  const watchedNamespaces = watched.map(namespaceOf);
  const events = useRejections(live, watchedNamespaces);
  const { rejections, refused } = events;
  const common = {
    namespaces: stores.namespaces,
    sources: stores.sources,
    rejections,
    reads,
  };

  return {
    stores,
    monitors: monitors
      ? monitorRows({
          ...common,
          serviceMonitors: stores.serviceMonitors,
          podMonitors: stores.podMonitors,
          scrapeConfigs: stores.scrapeConfigs,
          services: stores.services,
          endpointSlices: stores.endpointSlices,
          pods: stores.pods,
          targetsLoaded: stores.targetsLoaded,
        })
      : [],
    rules: rules ? ruleRows({ ...common, rules: stores.rules }) : [],
    instances: instanceRows(
      stores.prometheuses,
      stores.agents,
      stores.alertmanagers,
      alertingReads,
    ),
    reads,
    rejections,
    eventsRefused: refused.filter((namespace) => watchedNamespaces.includes(namespace)),
    live: liveState({
      loading: stores.state === "connecting",
      reads: [
        { asked, answers: reads },
        { asked: alertingAsked, answers: alertingReads },
      ],
      eventsWanted: events.asked,
      eventsRead: events.readFor,
    }),
  };
}
