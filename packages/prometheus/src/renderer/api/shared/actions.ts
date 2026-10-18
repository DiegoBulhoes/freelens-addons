import { Renderer } from "@freelensapp/extensions";
import { type AlertingRead, mergeAlerting } from "../instances/instances";
import { alertmanagersPath, apiReads, type QueryPod } from "../instances/query-pods";
import { mergeShards, type PrometheusRead } from "../monitors/scrape-pools";
import { reasonOf } from "./errors";
import { askInTurn } from "./live-reads";
import {
  parseAlertmanagers,
  parseAllocatorJobs,
  parsePools,
  parseRules,
  parseTargets,
} from "./prometheus-api";
import { withTimeout } from "./read-timeout";
import { REJECTED_REASON, type RejectionRead, settleRejections } from "./rejections";
import type { EventLike, MetricData, QueryRange } from "./types";

async function okJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

  return (await response.json()) as T;
}

const API_PROXY = "/api-kube";

// Through the API server's pod proxy, as cnpg reads its instance manager; needs get on pods/proxy.
async function promGet(url: string): Promise<unknown> {
  const { request } = Renderer.K8sApi.podsApi as unknown as {
    request: { get(url: string, params?: undefined, init?: RequestInit): Promise<unknown> };
  };

  return withTimeout((signal) => request.get(url, undefined, { signal }));
}

export async function readPrometheus(
  source: string,
  pods: QueryPod[],
  missing: string[],
  withRules: boolean,
): Promise<PrometheusRead> {
  if (missing.length > 0) return { source, error: missing.join("; ") };

  const shards = await Promise.all(
    pods.map(async (pod) => {
      const urls = apiReads(pod, withRules);

      try {
        const [targets, pools, rules] = await Promise.all([
          promGet(urls.targets),
          promGet(urls.pools),
          urls.rules ? promGet(urls.rules) : Promise.resolve(undefined),
        ]);

        return {
          targets: parseTargets(targets),
          pools: parsePools(pools),
          groups: withRules ? parseRules(rules) : undefined,
        };
      } catch (error) {
        return { error: reasonOf(error) };
      }
    }),
  );

  return mergeShards(source, shards);
}

// Apart from readPrometheus, so a refusal here leaves the targets and rules read.
export async function readAlerting(
  source: string,
  pods: QueryPod[],
  missing: string[],
): Promise<AlertingRead> {
  if (missing.length > 0) return { source, error: missing.join("; ") };

  const shards = await Promise.all(
    pods.map(async (pod) => {
      try {
        return { active: parseAlertmanagers(await promGet(alertmanagersPath(pod))) };
      } catch (error) {
        return { error: reasonOf(error) };
      }
    }),
  );

  return mergeAlerting(source, shards);
}

// Only /jobs, keyed by job name; /scrape_configs carries credentials. Needs get on services/proxy.
export async function readAllocatorJobs(
  source: string,
  namespace: string,
  collector: string,
): Promise<PrometheusRead> {
  try {
    const jobs = await promGet(
      `/api/v1/namespaces/${namespace}/services/${collector}-targetallocator:80/proxy/jobs`,
    );

    return { source, pools: parseAllocatorJobs(jobs) };
  } catch (error) {
    return { source, error: reasonOf(error) };
  }
}

/** The operator's rejections; Events in other namespaces are not read. */
export async function listRejectionEvents(namespaces: string[]): Promise<RejectionRead> {
  const results = await Promise.allSettled(
    namespaces.map(async (namespace) => {
      const response = await withTimeout((signal) =>
        fetch(
          `${API_PROXY}/api/v1/namespaces/${namespace}/events?fieldSelector=${encodeURIComponent(`reason=${REJECTED_REASON}`)}`,
          { signal },
        ),
      );

      return (await okJson<{ items?: EventLike[] }>(response)).items ?? [];
    }),
  );

  return settleRejections(namespaces, results);
}

/** Stops asking once `stopped` says the answer is no longer wanted. */
export function requestQueries<Key extends string>(
  queries: Record<Key, string>,
  range: QueryRange,
  stopped?: () => boolean,
): Promise<Partial<Record<Key, MetricData>>> {
  return askInTurn(
    queries,
    (query) =>
      withTimeout(async () => (await Renderer.K8sApi.requestMetrics(query, range)) as MetricData),
    stopped,
  );
}

export function openHostList(path: string): void {
  Renderer.Navigation.navigate(path);
}
