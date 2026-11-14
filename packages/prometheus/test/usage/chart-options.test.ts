import { describe, expect, it } from "vitest";
import { formatBytes, formatCores } from "../../src/renderer/api/shared/units";
import { TOOLTIP_ROWS, tooltipOptions } from "../../src/renderer/api/usage/chart-options";
import { groupedDatasets } from "../../src/renderer/api/usage/series";
import { podKeyOf } from "../../src/renderer/api/usage/usage";
import { usageItem } from "../support/fixtures";

const datasetsOf = (key: string) => groupedDatasets([usageItem(key).response], podKeyOf);

describe("the chart tooltip", () => {
  it("shows every line at the pointer, without waiting for it to land on a point", () => {
    const { interaction, plugins } = tooltipOptions("cores");

    expect(interaction).toEqual({ mode: "index", intersect: false });
    expect(plugins.tooltip).toMatchObject({ mode: "index", intersect: false });
  });

  it("names each pod, with CPU in cores and memory in bytes", () => {
    const cpu = datasetsOf("podCpu");
    const index = cpu.findIndex((line) => line.label === "monitoring/prometheus-seed-0");
    const point = cpu[index]?.data[0]?.y ?? Number.NaN;
    const label = (unit: "cores" | "bytes" | "rate") =>
      tooltipOptions(unit).plugins.tooltip.callbacks.label;

    expect(label("cores")({ datasetIndex: index, dataIndex: 0, dataset: cpu[index] ?? {} })).toBe(
      `monitoring/prometheus-seed-0: ${formatCores(point)}`,
    );

    const memory = datasetsOf("podMemory");
    const at = memory.findIndex((line) => line.label === "monitoring/prometheus-seed-0");

    expect(label("bytes")({ datasetIndex: at, dataIndex: 0, dataset: memory[at] ?? {} })).toBe(
      `monitoring/prometheus-seed-0: ${formatBytes(memory[at]?.data[0]?.y ?? Number.NaN)}`,
    );
    expect(label("rate")({ datasetIndex: 0, dataIndex: 10_000, dataset: memory[0] ?? {} })).toMatch(
      /: no data$/,
    );
    expect(
      label("cores")({
        datasetIndex: 0,
        dataIndex: 0,
        dataset: { label: "gap", data: [{ y: null }] },
      }),
    ).toBe("gap: no data");
  });

  it("lists at most ten rows, the busiest at the pointer, so the chart does not clip it", () => {
    // Memory and CPU together give more lines than the seed has pods.
    const cpu = [...datasetsOf("podCpu"), ...datasetsOf("podMemory")];
    const { filter } = tooltipOptions("cores").plugins.tooltip;
    const items = cpu.map((dataset, datasetIndex) => ({ datasetIndex, dataIndex: 0, dataset }));
    const kept = items.filter((item, index) => filter(item, index, items, { datasets: cpu }));
    const at = (datasetIndex: number) => cpu[datasetIndex]?.data[0]?.y ?? 0;
    const lowestKept = Math.min(...kept.map((item) => at(item.datasetIndex)));
    const highestDropped = Math.max(
      ...cpu
        .map((_, index) => index)
        .filter((index) => !kept.some((item) => item.datasetIndex === index))
        .map(at),
    );

    expect(cpu.length).toBeGreaterThan(TOOLTIP_ROWS);
    expect(kept).toHaveLength(TOOLTIP_ROWS);
    expect(lowestKept).toBeGreaterThanOrEqual(highestDropped);
    const gap = { label: "gap", data: [{ y: null }] };

    expect(
      filter({ datasetIndex: 0, dataIndex: 0, dataset: gap }, 0, [], { datasets: [gap] }),
    ).toBe(false);
  });

  it("lists the busiest first", () => {
    const cpu = datasetsOf("podCpu");
    const items = cpu.map((dataset, datasetIndex) => ({ datasetIndex, dataIndex: 0, dataset }));
    const { itemSort } = tooltipOptions("cores").plugins.tooltip;
    const sorted = [...items].sort((a, b) => itemSort(a, b, { datasets: cpu }));
    const values = sorted.map(({ datasetIndex }) => cpu[datasetIndex]?.data[0]?.y ?? 0);

    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(values[0]).toBeGreaterThan(values[values.length - 1] ?? 0);
  });
});
