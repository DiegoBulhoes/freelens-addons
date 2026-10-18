import type { MetricData, MetricResult, QueryRange } from "../shared/types";

export type Metric = MetricResult["metric"];

export interface Point {
  /** Unix seconds, as Prometheus sends them. */
  t: number;
  v: number;
}

export function seriesOf(data: MetricData | undefined): MetricResult[] {
  return Array.isArray(data?.data?.result) ? data.data.result : [];
}

// NaN and ±Inf are dropped: a gap reads as no data, never as a value.
export function pointsOf(series: MetricResult): Point[] {
  return series.values.flatMap(([t, value]) => {
    const v = Number(value);

    return Number.isFinite(v) ? [{ t, v }] : [];
  });
}

export function lastPoint(series: MetricResult): number | undefined {
  return pointsOf(series).at(-1)?.v;
}

export function hasSeries(
  data: MetricData | undefined,
  keep: (metric: Metric) => boolean = () => true,
): boolean {
  return seriesOf(data).some((series) => keep(series.metric) && pointsOf(series).length > 0);
}

/** `{}` from a failed query and an empty result look alike; both are "no data", never 0. */
export function isEmpty(data: MetricData | undefined): boolean {
  return !hasSeries(data);
}

/** Last value per key; several series on one key combine (sum by default). */
export function lastValues(
  data: MetricData | undefined,
  keyOf: (metric: Metric) => string | undefined,
  combine: (a: number, b: number) => number = (a, b) => a + b,
): Map<string, number> {
  const values = new Map<string, number>();

  for (const series of seriesOf(data)) {
    const key = keyOf(series.metric);
    const value = lastPoint(series);

    if (key === undefined || value === undefined) continue;

    const known = values.get(key);

    values.set(key, known === undefined ? value : combine(known, value));
  }

  return values;
}

export interface Dataset {
  /** Stable, so the host chart updates the line in place. */
  id: string;
  label: string;
  /** x in milliseconds, as the host's charts take it. */
  data: { x: number; y: number }[];
}

export function toDataset(id: string, label: string, points: Point[]): Dataset {
  return { id, label, data: points.map((point) => ({ x: point.t * 1000, y: point.v })) };
}

/** One dataset per key, adding every series on that key at the same time, over several answers. */
export function groupedDatasets(
  answers: (MetricData | undefined)[],
  keyOf: (metric: Metric) => string | undefined,
  keep: (key: string) => boolean = () => true,
): Dataset[] {
  const byKey = new Map<string, Map<number, number>>();

  for (const series of answers.flatMap(seriesOf)) {
    const key = keyOf(series.metric);

    if (key === undefined || !keep(key)) continue;

    const sums = byKey.get(key) ?? new Map<number, number>();

    for (const { t, v } of pointsOf(series)) sums.set(t, (sums.get(t) ?? 0) + v);
    byKey.set(key, sums);
  }

  return [...byKey]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, sums]) =>
      toDataset(
        key,
        key,
        [...sums].sort(([a], [b]) => a - b).map(([t, v]) => ({ t, v })),
      ),
    );
}

function gridTimes({ start, end, step }: QueryRange): number[] {
  const times: number[] = [];

  for (let t = start; t <= end; t += step) times.push(t);

  return times;
}

/** A level across the range, for a request, limit or capacity beside a usage line; none when unset. */
export function levelDataset(
  id: string,
  label: string,
  value: number | undefined,
  range: QueryRange,
): Dataset[] {
  return value === undefined
    ? []
    : [
        toDataset(
          id,
          label,
          gridTimes(range).map((t) => ({ t, v: value })),
        ),
      ];
}

export type GridLine<Line extends Dataset> = Omit<Line, "data"> & {
  data: { x: number; y: number | null }[];
};

// The chart's tooltip pairs lines by array index, so every line holds one point per step, null in a gap.
export function onGrid<Line extends Dataset>(lines: Line[], range: QueryRange): GridLine<Line>[] {
  const times = gridTimes(range).map((t) => t * 1000);

  return lines.map((line) => {
    const byTime = new Map(line.data.map((point) => [point.x, point.y]));

    return { ...line, data: times.map((x) => ({ x, y: byTime.get(x) ?? null })) };
  });
}
