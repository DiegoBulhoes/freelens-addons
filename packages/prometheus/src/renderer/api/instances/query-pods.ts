import { hasReadyCondition } from "../shared/pods";
import { namespaceOf } from "../shared/selectors";
import type { PodLike, PrometheusLike } from "../shared/types";
import { isDaemonSet } from "./instances";

export interface QueryPod {
  namespace: string;
  pod: string;
  port: number;
  shard: string;
  /** Pod-proxy path to the API root, with the TLS scheme and the route prefix. */
  proxy: string;
}

const SHARD_LABEL = "operator.prometheus.io/shard";

// The operator passes spec.routePrefix, or "/", as --web.route-prefix; externalUrl does not move the API.
function routePrefix(spec: PrometheusLike["spec"]): string {
  const trimmed = (spec.routePrefix ?? "").replace(/\/+$/, "");

  return trimmed === "" || trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function proxyPath(
  prometheus: PrometheusLike,
  pod: { namespace: string; pod: string; port: number },
): string {
  const scheme = prometheus.spec.web?.tlsConfig ? "https:" : "";

  return `/api/v1/namespaces/${pod.namespace}/pods/${scheme}${pod.pod}:${pod.port}/proxy${routePrefix(prometheus.spec)}`;
}

// state=active leaves out dropped targets, whose labels carry pod annotations.
export function apiReads(pod: QueryPod, withRules: boolean) {
  return {
    targets: `${pod.proxy}/api/v1/targets?state=active`,
    pools: `${pod.proxy}/api/v1/scrape_pools`,
    rules: withRules ? `${pod.proxy}/api/v1/rules` : undefined,
  };
}

export const alertmanagersPath = (pod: QueryPod) => `${pod.proxy}/api/v1/alertmanagers`;

const isReady = (pod: PodLike) => pod.status?.phase === "Running" && hasReadyCondition(pod);

/** One ready pod per shard, since each scrapes only its part; in DaemonSet mode every pod. */
export function queryPods(
  prometheus: PrometheusLike,
  kind: "Prometheus" | "PrometheusAgent",
  pods: PodLike[],
): { pods: QueryPod[]; missing: string[] } {
  const appName = kind === "Prometheus" ? "prometheus" : "prometheus-agent";
  const portName = prometheus.spec.portName ?? "web";
  const daemonSet = isDaemonSet(prometheus, kind);
  const shards = prometheus.spec.shards ?? 1;
  const chosen = new Map<string, QueryPod>();
  const notReady: string[] = [];

  for (const pod of pods) {
    const labels = pod.metadata.labels ?? {};

    if (
      pod.getNs() !== prometheus.getNs() ||
      labels["app.kubernetes.io/name"] !== appName ||
      labels["operator.prometheus.io/name"] !== prometheus.getName()
    ) {
      continue;
    }
    if (!isReady(pod)) {
      notReady.push(`Pod ${pod.getName()} is not running and ready`);
      continue;
    }

    const shard = daemonSet ? pod.getName() : (labels[SHARD_LABEL] ?? "0");
    const port = (pod.spec?.containers ?? [])
      .flatMap((container) => container.ports ?? [])
      .find((each) => each.name === portName)?.containerPort;

    if (port === undefined || chosen.has(shard)) continue;

    const place = { namespace: namespaceOf(pod), pod: pod.getName(), port };

    chosen.set(shard, { ...place, shard, proxy: proxyPath(prometheus, place) });
  }

  if (daemonSet) return { pods: [...chosen.values()], missing: notReady };

  const missing = Array.from({ length: shards }, (_, index) => String(index))
    .filter((shard) => !chosen.has(shard))
    .map((shard) => `No ready pod for shard ${shard}`);

  return { pods: [...chosen.values()], missing };
}
