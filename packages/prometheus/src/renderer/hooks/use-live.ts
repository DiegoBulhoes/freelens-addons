import { useEffect, useRef, useState } from "react";
import { type AlertingRead, asksAlerting } from "../api/instances/instances";
import { queryPods } from "../api/instances/query-pods";
import type { PrometheusRead } from "../api/monitors/scrape-pools";
import {
  listRejectionEvents,
  readAlerting,
  readAllocatorJobs,
  readPrometheus,
} from "../api/shared/actions";
import { JoinedReads, SharedReads } from "../api/shared/live-reads";
import { nextRetryDelay, REJECTIONS_MS, type RejectionRead } from "../api/shared/rejections";
import type { Source } from "../api/shared/selection";
import { objectKey } from "../api/shared/selectors";
import type { PodLike, PrometheusLike } from "../api/shared/types";
import { useVisibleTick } from "./use-visible-tick";

const LIVE_MS = 30_000;

/** Kept across pages so a page opens on what is known. */
const reads = new SharedReads<PrometheusRead>();

type Plan =
  | { source: string; kind: "Prometheus" | "PrometheusAgent"; pods: ReturnType<typeof queryPods> }
  | { source: string; kind: "TargetAllocator"; namespace: string; name: string };

function plansOf(
  prometheuses: PrometheusLike[],
  agents: PrometheusLike[],
  sources: Source[],
  pods: PodLike[],
): Plan[] {
  const plan = (kind: "Prometheus" | "PrometheusAgent") => (object: PrometheusLike) => ({
    source: objectKey(kind, object.getNs(), object.getName()),
    kind,
    pods: queryPods(object, kind, pods),
  });

  // A paused one is never asked: its configuration is not the one it would run.
  return [
    ...prometheuses.filter((each) => !each.spec.paused).map(plan("Prometheus")),
    ...agents.filter((each) => !each.spec.paused).map(plan("PrometheusAgent")),
    ...sources
      .filter((source) => source.kind === "TargetAllocator")
      .map((source) => ({
        source: source.key,
        kind: "TargetAllocator" as const,
        namespace: source.namespace,
        name: source.name,
      })),
  ];
}

const readOf = (plan: Plan) =>
  plan.kind === "TargetAllocator"
    ? readAllocatorJobs(plan.source, plan.namespace, plan.name)
    : readPrometheus(plan.source, plan.pods.pods, plan.pods.missing, plan.kind === "Prometheus");

/** Asks each plan's source again every 30s while shown; a plan with no answer on hand has not been read. */
function useSharedReads<Answer, Plan extends { source: string }>(
  store: SharedReads<Answer>,
  plans: Plan[],
  read: (plan: Plan) => Promise<Answer>,
): { reads: Answer[]; asked: string[] } {
  const [, setVersion] = useState(0);
  const tick = useVisibleTick(LIVE_MS);
  const key = JSON.stringify(plans);

  useEffect(() => store.subscribe(() => setVersion((current) => current + 1)), [store]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for the plans, fresh objects every render.
  useEffect(() => {
    for (const plan of plans) store.ask(plan.source, () => read(plan));
  }, [key, tick]);

  return {
    reads: plans.flatMap((plan) => store.get(plan.source) ?? []),
    asked: plans.map((plan) => plan.source),
  };
}

/** Read again every 30s while shown; a source in `asked` and not in `reads` has not answered. */
export function useLive(
  wanted: boolean,
  prometheuses: PrometheusLike[],
  agents: PrometheusLike[],
  sources: Source[],
  pods: PodLike[],
): { reads: PrometheusRead[]; asked: string[] } {
  return useSharedReads(reads, wanted ? plansOf(prometheuses, agents, sources, pods) : [], readOf);
}

const alerting = new SharedReads<AlertingRead>();

/** The Alertmanagers each running Prometheus with alerting set discovered, read as useLive does. */
export function useAlerting(
  wanted: boolean,
  prometheuses: PrometheusLike[],
  pods: PodLike[],
): { reads: AlertingRead[]; asked: string[] } {
  const plans = wanted
    ? prometheuses.filter(asksAlerting).map((each) => ({
        source: objectKey("Prometheus", each.getNs(), each.getName()),
        pods: queryPods(each, "Prometheus", pods),
      }))
    : [];

  return useSharedReads(alerting, plans, (plan) =>
    readAlerting(plan.source, plan.pods.pods, plan.pods.missing),
  );
}

const NOTHING_READ: RejectionRead = { rejections: new Map(), refused: [] };

const rejectionReads = new JoinedReads<RejectionRead>();

/** `readFor`: the namespaces the answer on hand was read for, which can lag `asked`. */
export function useRejections(
  wanted: boolean,
  namespaces: string[],
): RejectionRead & { asked: string; readFor: string | undefined } {
  const [rejections, setRejections] = useState<RejectionRead>(NOTHING_READ);
  const [readFor, setReadFor] = useState<string>();
  const [retry, setRetry] = useState(0);
  const failures = useRef({ joined: "", count: 0 });
  const tick = useVisibleTick(REJECTIONS_MS);
  const joined = wanted ? [...new Set(namespaces)].sort().join(",") : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick and retry are the triggers to read again.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (!joined) return;

    void rejectionReads
      .join(joined, () => listRejectionEvents(joined.split(",")))
      .then((read) => {
        if (cancelled) return;
        setRejections(read);
        setReadFor(joined);

        const before = failures.current.joined === joined ? failures.current.count : 0;
        const count = read.refused.length > 0 ? before + 1 : 0;

        failures.current = { joined, count };
        if (count > 0)
          timer = setTimeout(() => setRetry((current) => current + 1), nextRetryDelay(count));
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [joined, tick, retry]);

  // Kept while another set of namespaces is read: keys name the object, so extra ones match nothing.
  return { ...rejections, asked: joined, readFor };
}
