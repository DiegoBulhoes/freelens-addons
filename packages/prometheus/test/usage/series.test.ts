import { describe, expect, it } from "vitest";

import {
  groupedDatasets,
  hasSeries,
  isEmpty,
  lastPoint,
  lastValues,
  levelDataset,
  onGrid,
  pointsOf,
  seriesOf,
} from "../../src/renderer/api/usage/series";
import { usageItem } from "../support/fixtures";

const response = (key: string) => usageItem(key).response;
const podOf = (metric: Record<string, string | undefined>) =>
  metric.namespace && metric.pod ? `${metric.namespace}/${metric.pod}` : undefined;

describe("empty answers", () => {
  it("a failed query's {} and an empty result are both no data", () => {
    expect(isEmpty({})).toBe(true);
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty({ status: "success", data: { resultType: "matrix", result: [] } })).toBe(true);
    expect(isEmpty(response("nodeCpuUsed"))).toBe(false);
    expect(
      hasSeries(response("nodeLabelKubernetesNode"), (metric) => Boolean(metric.kubernetes_node)),
    ).toBe(false);
  });

  it("a series of NaN only is no data, and NaN points are dropped", () => {
    const answer = response("nodeCpuUsed");
    const [series] = seriesOf(answer);

    if (series) series.values = series.values.map(([t], index) => [t, index === 0 ? "1" : "NaN"]);
    expect(series && pointsOf(series)).toHaveLength(1);
    expect(series && lastPoint(series)).toBe(1);

    if (series) series.values = series.values.map(([t]) => [t, "+Inf"]);
    expect(isEmpty(answer)).toBe(true);
  });
});

describe("last values", () => {
  it("the last point of each series, per key", () => {
    expect(lastValues(response("nodeCpuUsed"), (metric) => metric.node)).toEqual(
      new Map([["freelens-addons-dev", 1.8517777777777775]]),
    );

    const memory = lastValues(response("podMemory"), podOf);

    expect(memory.get("monitoring/prometheus-seed-0")).toBe(330571776);
    expect(memory.get("monitoring/node-exporter-zwpw6")).toBe(21237760);
  });

  it("combines series on one key, and skips series without one", () => {
    const together = lastValues(response("podMemory"), (metric) => metric.namespace);

    expect(together.get("otel-collectors")).toBe(37666816 + 36347904 + 16207872);
    expect(
      lastValues(response("podMemory"), (metric) => metric.namespace, Math.max).get(
        "otel-collectors",
      ),
    ).toBe(37666816);
    expect(lastValues(response("podMemory"), () => undefined).size).toBe(0);
  });
});

describe("datasets", () => {
  it("adds the series on one key at each time, across answers", () => {
    const nodeOf = (metric: Record<string, string | undefined>) => metric.node;
    const rx = response("nodeNetRx");
    const tx = response("nodeNetTx");
    const [both] = groupedDatasets([rx, tx], nodeOf);
    const [rxOnly] = groupedDatasets([rx], nodeOf);
    const [txOnly] = groupedDatasets([tx], nodeOf);
    const last = (set: typeof both) => set?.data.at(-1)?.y ?? Number.NaN;

    expect(both?.id).toBe("freelens-addons-dev");
    expect(last(both)).toBeCloseTo(last(rxOnly) + last(txOnly));
    expect(both?.data.map((point) => point.x)).toEqual(
      [...(both?.data.map((point) => point.x) ?? [])].sort((a, b) => a - b),
    );

    const pods = groupedDatasets([response("podMemory"), {}], podOf, (key) =>
      key.startsWith("kube-system/"),
    );

    expect(pods.map((set) => set.id)).toEqual([
      "kube-system/coredns-54996dc9b4-kdcrl",
      "kube-system/local-path-provisioner-77b9867795-66hn2",
    ]);
    expect(groupedDatasets([undefined], nodeOf)).toEqual([]);
  });

  it("draws a request, limit or capacity as a level at every step, and nothing when unset", () => {
    expect(levelDataset("limit", "Limit", 2, { start: 10, end: 70, step: 30 })).toEqual([
      {
        id: "limit",
        label: "Limit",
        data: [
          { x: 10_000, y: 2 },
          { x: 40_000, y: 2 },
          { x: 70_000, y: 2 },
        ],
      },
    ]);
    expect(levelDataset("limit", "Limit", undefined, { start: 10, end: 70, step: 30 })).toEqual([]);
  });

  it("puts every line on one grid, so the same index is the same time in each", () => {
    const item = usageItem("podCpu");
    const range = { start: item.start, end: item.end, step: item.step };
    const [full, other] = groupedDatasets([item.response], podOf);
    const late = other && { ...other, data: other.data.slice(20) };
    const lines = onGrid(
      [full, late, ...levelDataset("limit", "Limit", 1, range)].filter(
        (line) => line !== undefined,
      ),
      range,
    );
    const xs = lines.map((line) => line.data.map((point) => point.x));

    expect(xs[0]?.length).toBe((item.end - item.start) / item.step + 1);
    expect(new Set(xs.map((each) => JSON.stringify(each))).size).toBe(1);
    expect(lines[1]?.data.slice(0, 20).every((point) => point.y === null)).toBe(true);
    expect(lines[1]?.data[20]?.y).toBe(late?.data[0]?.y);
  });
});
