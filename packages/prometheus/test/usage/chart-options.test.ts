import { describe, expect, it } from "vitest";
import { formatBytes, formatCores } from "../../src/renderer/api/shared/units";
import { TOOLTIP_ROWS, tooltipOptions } from "../../src/renderer/api/usage/chart-options";
import { groupedDatasets } from "../../src/renderer/api/usage/series";
import { podKeyOf } from "../../src/renderer/api/usage/usage";
import { usageItem } from "../support/fixtures";

const datasetsOf = (key: string) => groupedDatasets([usageItem(key).response], podKeyOf);

describe("the chart tooltip", () => {
  it("shows every line at the pointer, without waiting for it to land on a point", () => {
    const { hover, tooltips } = tooltipOptions("cores");

    expect(hover).toEqual({ mode: "index", intersect: false });
    expect(tooltips).toMatchObject({ mode: "index", intersect: false });
  });

  it("names each pod, with CPU in cores and memory in bytes", () => {
    const cpu = datasetsOf("podCpu");
    const index = cpu.findIndex((line) => line.label === "monitoring/prometheus-seed-0");
    const point = cpu[index]?.data[0]?.y ?? Number.NaN;

    expect(
      tooltipOptions("cores").tooltips.callbacks.label(
        { datasetIndex: index, index: 0 },
        { datasets: cpu },
      ),
    ).toBe(`monitoring/prometheus-seed-0: ${formatCores(point)}`);

    const memory = datasetsOf("podMemory");
    const at = memory.findIndex((line) => line.label === "monitoring/prometheus-seed-0");

    expect(
      tooltipOptions("bytes").tooltips.callbacks.label(
        { datasetIndex: at, index: 0 },
        { datasets: memory },
      ),
    ).toBe(`monitoring/prometheus-seed-0: ${formatBytes(memory[at]?.data[0]?.y ?? Number.NaN)}`);
    expect(
      tooltipOptions("rate").tooltips.callbacks.label(
        { datasetIndex: 0, index: 10_000 },
        { datasets: memory },
      ),
    ).toMatch(/: no data$/);
    expect(
      tooltipOptions("cores").tooltips.callbacks.label(
        { datasetIndex: 0, index: 0 },
        { datasets: [{ label: "gap", data: [{ y: null }] }] },
      ),
    ).toBe("gap: no data");
  });

  it("lists at most ten rows, the busiest at the pointer, so the chart does not clip it", () => {
    // Memory and CPU together give more lines than the seed has pods.
    const cpu = [...datasetsOf("podCpu"), ...datasetsOf("podMemory")];
    const { filter } = tooltipOptions("cores").tooltips;
    const kept = cpu
      .map((_, datasetIndex) => ({ datasetIndex, index: 0 }))
      .filter((item) => filter(item, { datasets: cpu }));
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
    expect(
      filter({ datasetIndex: 0, index: 0 }, { datasets: [{ label: "gap", data: [{ y: null }] }] }),
    ).toBe(false);
  });

  it("lists the busiest first", () => {
    const cpu = datasetsOf("podCpu");
    const items = cpu.map((_, datasetIndex) => ({ datasetIndex, index: 0 }));
    const { itemSort } = tooltipOptions("cores").tooltips;
    const sorted = [...items].sort((a, b) => itemSort(a, b, { datasets: cpu }));
    const values = sorted.map(({ datasetIndex }) => cpu[datasetIndex]?.data[0]?.y ?? 0);

    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(values[0]).toBeGreaterThan(values[values.length - 1] ?? 0);
  });
});
