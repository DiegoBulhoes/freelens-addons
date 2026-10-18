import { useEffect, useRef, useState } from "react";

import { requestQueries } from "../api/shared/actions";
import { ReadGate } from "../api/shared/live-reads";
import type { MetricData, QueryRange } from "../api/shared/types";
import { hasSeries } from "../api/usage/series";
import {
  CLUSTER_PROBE,
  clustersFrom,
  currentRange,
  metricsKey,
  NODE_LABELS,
  type NodeLabel,
  nodeLabelFrom,
  type Period,
  periodCurrent,
  periodRange,
  probeQuery,
  probeRetryIn,
} from "../api/usage/usage-queries";

export interface Metrics<Key extends string> {
  data: Partial<Record<Key, MetricData>>;
  /** The range the data answers; undefined before the first answer. */
  range?: QueryRange;
  loading: boolean;
  /** Moves on each answer, for a read that must follow this one. */
  answers: number;
}

/** Asks again when `tick` moves, unless these are still loading; the last answer stays shown. */
export function useMetrics<Key extends string>(
  queries: Record<Key, string> | undefined,
  period: Period,
  kind: "current" | "chart",
  tick: number,
): Metrics<Key> {
  const [read, setRead] = useState<{
    key: string;
    data: Metrics<Key>["data"];
    range?: QueryRange;
    answers: number;
  }>({ key: "", data: {}, answers: 0 });
  const [loading, setLoading] = useState(false);
  const [gate] = useState(() => new ReadGate());
  const key = queries ? metricsKey(queries, period, kind) : "";
  const wanted = useRef({ key, mounted: true });

  wanted.current.key = key;

  useEffect(
    () => () => {
      wanted.current.mounted = false;
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for the queries, a fresh object every render.
  useEffect(() => {
    if (!queries) return;

    const range =
      kind === "current" ? periodCurrent(period, Date.now()) : periodRange(period, Date.now());
    let stopped = false;
    // Sticky: a read cut short stays partial even if these queries come back.
    const stale = () => {
      stopped ||= !wanted.current.mounted || wanted.current.key !== key;

      return stopped;
    };
    const asked = gate.run(key, () => requestQueries(queries, range, stale));

    if (!asked) return;

    setLoading(true);
    void asked.then((data) => {
      if (stale()) return;
      setRead((last) => ({ key, data, range, answers: last.answers + 1 }));
      setLoading(false);
    });
  }, [key, tick]);

  if (!queries) return { data: {}, loading: false, answers: read.answers };

  // An answer to other queries says nothing about these.
  return read.key === key
    ? { data: read.data, range: read.range, loading, answers: read.answers }
    : { data: {}, loading: true, answers: read.answers };
}

export interface NodeLabelProbe {
  label?: NodeLabel;
  /** Every probe's answer, in order; empty until all are asked or one names a node. */
  probes: (MetricData | undefined)[];
  probed: boolean;
  /** The cluster labels on node-exporter's series; more than one means a shared tenant. */
  clusters: string[];
}

/** The label naming the node on node-exporter's series; retried a few times, then each tick. */
export function useNodeLabel(tick: number): NodeLabelProbe {
  const [probe, setProbe] = useState<NodeLabelProbe>({ probes: [], probed: false, clusters: [] });
  const [attempt, setAttempt] = useState(0);
  const found = probe.label !== undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: once a label is found, a tick asks nothing.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (found) return;

    void (async () => {
      const probes: Partial<Record<NodeLabel, MetricData>> = {};
      const range = currentRange(Date.now());

      for (const label of NODE_LABELS) {
        const answer = await requestQueries({ probe: probeQuery(label) }, range);

        if (cancelled) return;

        probes[label] = answer.probe;
        if (hasSeries(answer.probe, (metric) => Boolean(metric[label]))) break;
      }

      const label = nodeLabelFrom(probes);
      const clusters = label
        ? (await requestQueries({ clusters: CLUSTER_PROBE }, range)).clusters
        : undefined;

      if (cancelled) return;

      setProbe({
        label,
        probes: NODE_LABELS.map((each) => probes[each]),
        probed: true,
        clusters: clustersFrom(clusters),
      });

      const delay = probeRetryIn(label !== undefined, attempt);

      if (delay !== undefined) timer = setTimeout(() => setAttempt((last) => last + 1), delay);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tick, attempt]);

  return probe;
}
